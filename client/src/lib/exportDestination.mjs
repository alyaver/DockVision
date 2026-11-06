// stores export folders in the browser
const DATABASE_NAME = "dockvision-export";
const STORE_NAME = "destinations";

// opens the db to remember user's export folder
function openDatabase() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error(
                "This browser cannot remember export folders. Download artifacts manually."
            ));
            return;
        }
        
        const request = indexedDB.open(DATABASE_NAME, 1);
        
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME);
        };
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(
            "Close other DockVision tabs and try again."
        ));
    });
}

// Read or update only the signed-in user's destination record.
async function accessDestination(userId, mode, operation) {
    if (userId == null || String(userId).trim() === "") {
        throw new Error("Sign in before managing your export destination.");
    }
    
    const database = await openDatabase();
    
    try {
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, mode);
            const store = transaction.objectStore(STORE_NAME);
            const request = operation(store, String(userId));
            
            // Wait for the transaction to finish before reporting success.
            transaction.oncomplete = () => resolve(request.result ?? null);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(
                transaction.error || new Error("Export destination was not saved.")
            );
        });
    } finally {
        database.close();
    }
}

export function getExportDestination(userId) {
    return accessDestination(userId, "readonly", (store, key) =>
        store.get(key)
);
}

export function saveExportDestination(userId, directory) {
    // IndexedDB preserves the folder handle without JSON conversion.
    return accessDestination(userId, "readwrite", (store, key) =>
        store.put({ directory, enabled: true }, key)
);
}

export async function disableExportDestination(userId) {
    const existing = await getExportDestination(userId);
    
    // keep the last folder so it can start there when automatic saving is enabled, while disabling automatic saving.
    return accessDestination(userId, "readwrite", (store, key) =>
        store.put({
        directory: existing?.directory ?? null,
        enabled: false,
    }, key)
);
}

export function rememberRunExport(userId, runId, directory) {
    if (!runId) {
        throw new Error("A run ID is required to remember its export choice.");
    }
    
    return accessDestination(userId, "readwrite", (store) =>
        // Array keys keep run records separate from destination preferences.
    store.put(
        {
            runId,
            directory: directory ?? null,
            status: directory ? "pending" : "disabled",
        },
        [String(userId), runId]
    )
);
}

export function getRunExport(userId, runId) {
    // only retrieve this account's export choice for this run.
    return accessDestination(userId, "readonly", (store) =>
        store.get([String(userId), runId])
);
}

export async function saveFinalizedRunExport(userId, run, { signal } = {}) {
    const terminal = ["completed", "failed", "cancelled"];
    
    // execution must end and every published iteration must finish first.
    if (
        !terminal.includes(String(run?.status).toLowerCase()) ||
        run.artifactsFinalized !== true
    ) {
        return getRunExport(userId, run?.runId);
    }
    
    const runId = run.runId;
    
    // The run ID becomes one folder name, never a directory path.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) {
        throw new Error("This run has an invalid export folder name.");
    }
    
    if (String(run.ownerUserId) !== String(userId)) {
        throw new Error("This run is not available for this account.");
    }
    
    if (!globalThis.navigator?.locks?.request) {
        throw new Error(
            "Automatic export is unavailable in this browser. Download artifacts manually."
        );
    }
    
    // Serialize attempts across tabs so the same run cannot export twice.
    return navigator.locks.request(
        `dockvision-export:${runId}`,
        async () => {
            let record = await getRunExport(userId, runId);
            
            if (!record || record.status === "disabled") return record;
            if (record.status === "completed") return record;
            
            async function remember(updates) {
                record = { ...record, ...updates };
                
                await accessDestination(userId, "readwrite", (store) =>
                    store.put(record, [String(userId), runId])
            );
            
            return record;
        }
        
        function checkOpen() {
            // Interrupted exports stay pending and can resume on return.
            signal?.throwIfAborted();
        }
        
        try {
            checkOpen();
            
            const directory = record.directory;
            
            if (!directory?.queryPermission) {
                throw new Error("Choose an export folder again.");
            }
            
            // Automatic saving must not open a permission prompt from an effect.
            const permission = await directory.queryPermission({
                mode: "readwrite",
            });
            
            if (permission !== "granted") {
                return remember({
                    status: "needs_permission",
                    message:
                    "Folder permission is required. Choose the folder again to authorize saving.",
                });
            }
            
            const files = new Map();
            
            for (const artifact of Object.values(run.artifacts || {}).flat()) {
                if (!artifact?.url) continue;
                
                const relativePath = artifact.relativePath;
                const parts =
                typeof relativePath === "string"
                ? relativePath.split("/")
                : [];
                
                if (
                    !parts.length ||
                    parts.some(
                        (part) =>
                            !part ||
                        part === "." ||
                        part === ".." ||
                        /[\\<>:"|?*\u0000-\u001f]/.test(part) ||
                        /[. ]$/.test(part)
                    )
                ) {
                    throw new Error("An artifact has an invalid export filename.");
                }
                
                const key = relativePath.toLowerCase();
                const existing = files.get(key);
                
                if (existing && existing.relativePath !== relativePath) {
                    throw new Error("Two artifacts have conflicting filenames.");
                }
                
                files.set(key, { ...artifact, parts });
            }
            
            if (!files.size) {
                return remember({
                    status: "empty",
                    message: "This run has no available artifacts to export.",
                });
            }
            
            checkOpen();
            
            const exportFolder = await directory.getDirectoryHandle(runId, {
                create: true,
            });
            
            if (record.exportFolder) {
                // Resume only in the same folder this browser previously claimed.
                if (!(await record.exportFolder.isSameEntry(exportFolder))) {
                    throw new Error("The run's export folder has changed.");
                }
            } else {
                // An existing nonempty folder may belong to another export or user, cant overwrite it
                for await (const entry of exportFolder.values()) {
                    throw new Error(
                        "A nonempty folder already exists for this run."
                    );
                }
                
                await remember({
                    exportFolder,
                    status: "pending",
                });
            }
            
            for (const artifact of files.values()) {
                checkOpen();
                
                const response = await fetch(artifact.url, {
                    credentials: "include",
                    signal,
                });
                
                if (!response.ok) {
                    throw new Error("An artifact could not be downloaded.");
                }
                
                const contents = await response.blob();
                let folder = exportFolder;
                
                for (const part of artifact.parts.slice(0, -1)) {
                    checkOpen();
                    folder = await folder.getDirectoryHandle(part, { create: true });
                }
                
                const filename = artifact.parts.at(-1);
                let existingFile = null;
                
                try {
                    existingFile = await folder.getFileHandle(filename);
                } catch (error) {
                    if (error.name !== "NotFoundError") throw error;
                }
                
                if (existingFile) {
                    // a previous attempt may have saved this file before interruption, reuse identical contents and never replace different contents.
                    const saved = await existingFile.getFile();
                    const left = new Uint8Array(await saved.arrayBuffer());
                    const right = new Uint8Array(await contents.arrayBuffer());
                    
                    if (
                        left.length !== right.length ||
                        left.some((value, index) => value !== right[index])
                    ) {
                        throw new Error(
                            "An existing file has different contents."
                        );
                    }
                    
                    continue;
                }
                
                checkOpen();
                
                const file = await folder.getFileHandle(filename, { create: true });
                const writable = await file.createWritable();
                
                try {
                    checkOpen();
                    await writable.write(contents);
                    checkOpen();
                    await writable.close();
                } catch (error) {
                    await writable.abort().catch(() => {});
                    throw error;
                }
            }
            
            checkOpen();
            
            // Claim success only after every file has finished writing
            return remember({
                status: "completed",
                fileCount: files.size,
                message: `${files.size} artifact(s) saved in ${runId}.`,
            });
        } catch (error) {
            if (signal?.aborted || error.name === "AbortError") {
                return remember({
                    status: "pending",
                    message: "Export interrupted. Return to this run to resume.",
                });
            }
            
            const permissionLost =
            error.name === "NotAllowedError" ||
            error.name === "SecurityError";
            
            return remember({
                status: permissionLost ? "needs_permission" : "failed",
                message: permissionLost
                ? "Folder permission was lost. Choose the folder again."
                : "Export did not finish; some files may have been saved. Check that the destination exists and is writable. Existing files with different contents will not be overwritten.",
            });
        }
    }
);
}

export async function changeRunExportDestination(userId, runId, directory) {
    if (!globalThis.navigator?.locks?.request) {
        throw new Error(
            "Automatic export is unavailable in this browser. Download artifacts manually."
        );
    }
    
    // Use the same lock as saving so recovery cannot interrupt an active export
    return navigator.locks.request(
        `dockvision-export:${runId}`,
        async () => {
            const existing = await getRunExport(userId, runId);
            
            if (!existing || existing.status === "disabled") {
                throw new Error("Automatic export is not configured for this run.");
            }
            
            // Never reset a completed export and silently save another copy
            if (existing.status === "completed") return existing;
            
            let sameDirectory = false;
            
            try {
                sameDirectory = await existing.directory.isSameEntry(directory);
            } catch {
                // removed folder cant support comparison
            }
            
            const updated = {
                ...existing,
                directory,
                exportFolder: sameDirectory ? existing.exportFolder : null,
                status: "pending",
                message: "Export is ready to retry.",
            };
            
            // Update the remembered preference and run choice together.
            await accessDestination(userId, "readwrite", (store, key) => {
                store.put({ directory, enabled: true }, key);
                return store.put(updated, [String(userId), runId]);
            });
            
            return updated;
        }
    );
}