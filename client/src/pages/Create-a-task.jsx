import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Create-a-task.css";
import Navigation from "../components/Navigation";
import { serializeTaskPlan } from "../lib/serializeTaskPlan.mjs";

const Default_Task = [];
const Task_Options = ["TYPE", "CLICK"];
const Notepad_Targets = [ // List of targets for the notepad referenced from docs/pywinauto-vm-notepad-demo/READNE.md
    "editor",
    "fileMenu",
    "editMenu",
    "formatMenu",
    "viewMenu",
    "helpMenu",
    "notepad.editor",
    "notepad.fileMenu",
    "notepad.editMenu",
    "notepad.formatMenu",
    "notepad.viewMenu",
    "notepad.helpMenu",
]
const Notepad_Reference_Images = [ // List of reference images for the notepad screen
    {
        id: "notepad_screen_main",
        label: "Notepad Editor",
        src: "",
        width: 1280,
        height: 720,
    },
    {
        id: "notepad_screen_file_menu",
        label: "Notepad File Menu",
        src: "",
        width: 1280,
        height: 720,
    },
    {
        id: "notepad_screen_edit_menu",
        label: "Notepad Edit Menu",
        src: "",
        width: 1280,
        height: 720,
    }
]

function getCoordinateDetails(details = {}) { // Returns the coordinate details, ensuring x and y are numbers and providing a default reference image ID if not present
    return {
        xPercent: details.xPercent ?? "",
        yPercent: details.yPercent ?? "",
        referenceImageId: details.referenceImageId || Notepad_Reference_Images[0]?.id || "",
    };
}

function getReferenceImageIndex(referenceImages, referenceImageId) { // Returns the index of the reference image based on the referenceImageId, or 0 if not found
    const index = referenceImages.findIndex((image) => image.id === referenceImageId);
    return index >= 0 ? index : 0;
}

function getSelectedReferenceImage(referenceImages, referenceImageId) { // Returns the selected reference image based on the referenceImageId, or the first image if not found
    return referenceImages.find((image) => image.id === referenceImageId) || referenceImages[0] || null;
}

function getMarkerStyle(details, image) { // Returns the style for the marker based on the coordinates and reference image, since the coordinates are relative to the reference image, we need to calculate the percentage position of the marker based on the image dimensions
    if (!image || details?.xPercent === "" || details?.yPercent === "" || details?.xPercent === undefined || details?.yPercent === undefined) {
        return null;
    }
    
    const x = Number(details?.xPercent);
    const y = Number(details?.yPercent);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }

    return {
        left: `${Math.min(Math.max(x, 0), 100)}%`,
        top: `${Math.min(Math.max(y, 0), 100)}%`,
    }
}

function getCoordinateFromPreview(event, image) { // Returns the coordinates based on the marker style and reference image, since the marker style is in percentage, we need to calculate the absolute position based on the image dimensions
    const rect = event.currentTarget.getBoundingClientRect(); // Get the bounding rectangle of the image container

    const imgAspectRatio = image.width / image.height;
    const previewAspectRatio = rect.width / rect.height;

    let previewWidth = rect.width;
    let previewHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (imgAspectRatio > previewAspectRatio) { // Image is wider than the preview container
        previewHeight = rect.width / imgAspectRatio;
        offsetY = (rect.height - previewHeight) / 2;
    } else { // Image is taller than the preview container
        previewWidth = rect.height * imgAspectRatio;
        offsetX = (rect.width - previewWidth) / 2;
    }

    const clickX = event.clientX - rect.left - (offsetX || 0);
    const boundedClickX = Math.min(Math.max(clickX, 0), previewWidth || rect.width);

    const clickY = event.clientY - rect.top - (offsetY || 0);
    const boundedClickY = Math.min(Math.max(clickY, 0), previewHeight || rect.height);

    return {
        xPercent: Number(((boundedClickX / previewWidth) * 100).toFixed(2)),
        yPercent: Number(((boundedClickY / previewHeight) * 100).toFixed(2)),
    };
}

function TaskSelect({value, tasks, onChange}) {
return (
  <select value={value} onChange={onChange} className="task-select">
    <option value="">Select a task</option>
    {tasks.map((c) => (
      <option key={c} value={c}>
        {c}
      </option>
    ))}
  </select>
);
}

// Drafts survive refresh and navigation within session
function loadDraftTask(key, value) {
    try {
        const savedDraft = sessionStorage.getItem(key);
        return savedDraft ? JSON.parse(savedDraft) : value;
    } catch {
        return value;
    }
}

function validateDraftTask(task) {
    const errors = {};

    if (!task.task) {
        errors.task = "Task type is required.";
    }

    if (task.task === "TYPE" && !task.text) {
        errors.text = "Text is required for TYPE task.";
    }

    if (task.task === "CLICK") {
        if(task.targetType === "named" && !task.target) {
            errors.target = "Target is required for CLICK task.";
        }

        if (task.targetType === "coordinates") {
            if (!task.details || task.details.xPercent === undefined || task.details.yPercent === undefined || task.details.xPercent === "" || task.details.yPercent === "") {
                errors.details = "X and Y coordinates are required for CLICK task.";
            }
        }
    }
    return errors;
}

function CoordinateReferencePreview({ image, details, onSelectCoordinates }) { // Displays a preview of the reference image with a marker at the specified coordinates
    const markerStyle = getMarkerStyle(details, image);

    if (!image) {
        return null;
    }

    function handlePreviewClick(event) { // When the user clicks on the preview, we calculate the coordinates based on the click position and update the details
        if (!image) return;

        const coordinates = getCoordinateFromPreview(event, image);
        if (onSelectCoordinates) {
            onSelectCoordinates(coordinates);
        }
    }

    return (
        <div className="coordinate-preview">
            <div className="coordinate-preview-screen" onClick={handlePreviewClick}>
                {image.src ? (
                    <img src={image.src} alt={image.label}/>
                ) : (
                    <div className="reference-image-placeholder">{image.label}</div>
                )}

                {markerStyle && (
                    <div className="coordinate-marker" style={markerStyle}></div>
                )}
            </div>
        </div>
    );
}

function CreateTask({taskDescription, tasks, onChangeText,onChangeDetail, onChangeTask, onSave, onCancel, onChangeTargetType, onChangeTarget, referenceImages}) {
    const isClick = taskDescription.task === "CLICK";
    const isTyped = taskDescription.task === "TYPE";
    const selectedReferenceImageId = taskDescription.details?.referenceImageId || Notepad_Reference_Images[0]?.id || "";
    const selectedReferenceImage = getSelectedReferenceImage(referenceImages, selectedReferenceImageId);
    const selectedReferenceImageIndex = getReferenceImageIndex(referenceImages, selectedReferenceImageId);
    return (
        <div className="create-task-container">
            <TaskSelect value={taskDescription.task} tasks={tasks} onChange={(e) => onChangeTask(e.target.value)} />
           
           {taskDescription.errors?.task && (
             <p className="field-error">{taskDescription.errors.task}</p>
            )}

           {isTyped && (
            <>
                <input
                    type="text"
                    placeholder="Enter task"
                    value={taskDescription.text}
                    onChange={(e) => onChangeText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") onSave();
                        if (e.key === "Escape") onCancel();
                    }}
                    className="task-input"
                />
                    {taskDescription.errors?.text && (
                        <p className="field-error">{taskDescription.errors.text}</p>
                    )}
            </>
            )}

            {isClick && (
                <div className="click-fields">
                    <select  className="target-select" value={taskDescription.targetType || "named"} onChange={(e) => onChangeTargetType(e.target.value)}>
                        <option value="named">Named Target</option>
                        <option value="coordinates">Coordinates</option>
                    </select>

                    {taskDescription.targetType === "named" && (
                        <>
                            <select className="target-select" value={taskDescription.target || "editor"} onChange={(e) => onChangeTarget(e.target.value)}>
                                {Notepad_Targets.map((target) => (
                                    <option key={target} value={target}>
                                        {target}
                                    </option>
                                ))}
                            </select>

                            {taskDescription.errors?.details && (
                                <p className="field-error">{taskDescription.errors.details}</p>
                            )}
                        </>
                    )}

                    {taskDescription.targetType === "coordinates" && (
                        <><div className="coordinate-image-navigation">
                            <select className="reference-image-select" value={selectedReferenceImageId} onChange={(e) => onChangeDetail("referenceImageId", e.target.value)}>
                                {referenceImages.map((image) => (
                                    <option key={image.id} value={image.id}>
                                        {image.label}
                                    </option>
                                ))}
                            </select>
                            <span className="reference-image-index"> Screen {selectedReferenceImageIndex + 1} of {referenceImages.length}</span>
                        </div>

                        <CoordinateReferencePreview image={selectedReferenceImage} details={taskDescription.details} onSelectCoordinates={(coordinates) => {
                            onChangeDetail("xPercent", coordinates.xPercent);
                            onChangeDetail("yPercent", coordinates.yPercent);
                        }} />
                        
                            <input type="number" placeholder="X percent" className="coordinate-input" value={taskDescription.details?.xPercent ?? ""}
                            onChange={(e) => onChangeDetail("xPercent", e.target.value) } />
                            <input type="number" placeholder="Y percent" className="coordinate-input" value={taskDescription.details?.yPercent ?? ""}
                            onChange={(e) => onChangeDetail("yPercent", e.target.value) } />

                            {taskDescription.errors?.details && (
                                <p className="field-error">{taskDescription.errors.details}</p>
                            )}
                        </>
                    )}
                </div>
            )}



            <div className="button-container">
                <button onClick={onSave} className="save-button">Save</button>
                <button onClick={onCancel} className="cancel-button">Cancel</button>
            </div>
            </div>
    );
}


export default function CreateATask() {
    const navigate = useNavigate(); 
    const savedDraft = loadDraftTask("defTask", {name: "", nextID: 1, tasks: Default_Task});
    const [taskDescription, setTaskDescription] = useState(null);
    const [tasks, setTasks] = useState(Task_Options);
    const [newTaskName, setNewTaskName] = useState(savedDraft.name || "");
    const [nextID, setNextID] = useState(savedDraft.nextID || 1);
    const [defTask, setDefTask] = useState(savedDraft.tasks || Default_Task);
    const [locked, setLocked] = useState(false);
    const [confirmOn, setConfirmOn] = useState(null);
    const [exit, setExit] = useState(false);
    const [createTaskError, setCreateTaskError] = useState(null);

    useEffect(() => {
        sessionStorage.setItem("defTask", JSON.stringify({name: newTaskName, nextID,tasks: defTask}));
    }, [newTaskName, nextID, defTask]);

    function openAddTask() {
        if(locked)  return;
        setTaskDescription({ mode: "new", task: "", text: "", details: {}, errors: {} });
    }

    function openEditTask(task) {
        if(locked)  return;
        setTaskDescription({ mode: "edit", id: task.id, text: task.text, task: task.task, targetType: task.targetType || "coordinates", target: task.target || "editor", details: task.details || {}, errors: {}, });
    }

    function changeTaskType(newType) {
        setTaskDescription({ ...taskDescription, task: newType, text: "", details: newType === "CLICK" ? { xPercent: "", yPercent: "" } : {}, targetType: newType === "CLICK" ? "named" : "", target: newType === "CLICK" ? "editor" : "", errors: {} });
    }

    function changeTargetType(targetType) { // // When selecting CLICK task, switch between coordinates and named target types
        setTaskDescription({ ...taskDescription, targetType: targetType, target: targetType === "named" ? "editor" : "", details: targetType === "coordinates" ? getCoordinateDetails(taskDescription.details) : {}, errors: {} });
    }

    function changeTarget(target) { // When selecting CLICK task, switch between coordinates and named target types
        setTaskDescription({ ...taskDescription, target: target, errors: {} });
    }

    function cancelTask() {
        setTaskDescription(null);
    }

    function moveTask(id, direction) {
        const index = defTask.findIndex((t) => t.id === id);
        const newIndex = index + direction;

        if (newIndex < 0 || newIndex >= defTask.length) return; // Out of bounds

        const newDefTask = [...defTask];
        [newDefTask[index], newDefTask[newIndex]] = [newDefTask[newIndex], newDefTask[index]]; // Swap the tasks
        setDefTask(newDefTask);
    }

    // Validates the task plan before saving
    function planValidation() {
        if (defTask.length === 0) {
            setCreateTaskError("You must add at least one task before saving.");
            return false;
        }
 
        const countInvalid = defTask.some((task) => Object.keys(validateDraftTask(task)).length > 0);
        if (countInvalid) {
            setCreateTaskError("There are invalid tasks in the plan.");
            return false;
        }
        setCreateTaskError("");
        return true;
    }

    // saves a new task or an edited task to the task list
    function saveTask() {
        if(!taskDescription) return;
        const details = taskDescription.targetType === "coordinates" ? getCoordinateDetails(taskDescription.details) : {};
        const errors = validateDraftTask(taskDescription);
        if (Object.keys(errors).length > 0) { // If there are validation errors, set the errors in the taskDescription state and return
            setTaskDescription({ ...taskDescription, errors });
            return;
        }
        if(taskDescription.mode === "new") {
            const newTask = { id: `step-${nextID}`, text: taskDescription.text, task: taskDescription.task, details: details, targetType: taskDescription.targetType, target: taskDescription.target};
            setDefTask([...defTask, newTask]);
            setNextID(nextID + 1);
        } else if(taskDescription.mode === "edit") {
            setDefTask(defTask.map(t => t.id === taskDescription.id ? { ...t, text: taskDescription.text, task: taskDescription.task, details: details, targetType: taskDescription.targetType, target: taskDescription.target } : t));
        }
        setTaskDescription(null);  
    }

    function deleteTask(id) {
        setDefTask((prev)  => prev.filter((t) => t.id !== id));
        if (taskDescription && taskDescription.mode === "edit" && taskDescription.id === id) {
            setTaskDescription(null);
        }
    }

    function handleConfirm(){
        setLocked(true);
        setTaskDescription(null);
        setConfirmOn(true);
        exportJson();
        
    }

    function handleUnlock(){
        setLocked(false);
        setConfirmOn(null);
    }

    // use the current plan made by the user and directly add it into setup in Dashboard
    function useThisPlan() {
        if(!planValidation()) return;

        const CURRENT_RUN_STORAGE_KEY = loadDraftTask("dockvision-current-run", {});
        const taskListName = newTaskName.trim() 
            ? newTaskName.trim().replace(/[^a-zA-Z0-9]+/gi, "_").toLowerCase() : "task_list";

        sessionStorage.setItem(
            "dockvision-current-run",
            JSON.stringify({
                ...CURRENT_RUN_STORAGE_KEY,
                configFileName: `${taskListName}.json`,
                configContent: buildPlan(),
            })
        )
        navigate("/dashboard");
    }



    function updateDetail(key, value) {
        setDefTask(defTask.map(t => {
            if (t.details && t.details[key] !== undefined) {
                return { ...t, details: { ...t.details, [key]: value } };

            }
            return t;
        }));
    }   

    function onChangeDetail(key, value) {
        setTaskDescription((current) => ({ ...current, details: { ...current.details, [key]: value } }));
    }

    function buildPlan() {
        return serializeTaskPlan(newTaskName, defTask);
    }

    function exportJson() { // Exports the task list to a JSON file
        if (!planValidation()) {
            return;
        }
        const dataStr = buildPlan();
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const taskListName = newTaskName.trim() 
            ? newTaskName.trim().replace(/[^a-zA-Z0-9]+/gi, "_").toLowerCase() : "task_list";
        link.href = url;
        link.download = `${taskListName}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function newDraft() { // gives user a blank canvas while not overwriting the active run's identity
        setNewTaskName("");
        setNextID(1);
        setDefTask([]);
        setTaskDescription(null);
        setCreateTaskError("");
        setLocked(false);
        setConfirmOn(null);
        sessionStorage.removeItem("defTask");
    }

    return (
        <div className="create-task-form">
            <Navigation />
            <div className="task-container">
                {!exit ? (
                    <div className="panel">

                    <div className="create-task-header">
                                {/*  in case we want to keep dashboard later, delete for now

                                <button onClick={() => navigate("/Dashboard")} className="back-button">Dashboard</button> 
                                
                                */}
                                <button onClick={() => setExit(true)} className="exit-button">Exit</button>
                    </div>


                        <div className="head-panel">
                            <input value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} placeholder="Enter task name" />
                        </div>

                        <div className="body-panel">
                            <span>
                                {defTask.length}
                                {defTask.length === 1 ? " task" : " tasks"}
                            </span>
                            <button onClick={openAddTask} disabled={locked} className="add-button">Add Task</button>
                        </div>

                        {createTaskError && <div className="error-message">{createTaskError}</div>}
                        
                        <div className="task-list">
                            {defTask.length === 0 && !taskDescription && (
                                <div className="no-tasks-message">No tasks available. CLICK "Add Task" to create one.
                                </div>
                            )}

                            {defTask.map((t) => 
                                taskDescription && taskDescription.mode === "edit" && taskDescription.id === t.id ? (
                                    <CreateTask
                                        key={t.id}
                                        tasks={tasks}
                                        taskDescription={taskDescription}
                                        referenceImages={Notepad_Reference_Images}
                                        onChangeText={(v) => setTaskDescription({ ...taskDescription, text:v })}
                                        onChangeTask={changeTaskType}
                                        onChangeTargetType={changeTargetType}
                                        onChangeTarget={changeTarget}
                                        onChangeDetail={onChangeDetail}
                                        onSave={saveTask}
                                        onCancel={cancelTask} 
                                    />
                                ) : (
                                    <div key={t.id} className="task-item">
                                        <div>
                                         <span>{t.task}</span>
                                         {t.task === "TYPE" && t.text && (
                                            <div>
                                            <span>Text: {t.text}</span>
                                            </div>
                                            )}

                                        {t.task === "CLICK" && t.targetType === "named" && (
                                            <div>
                                            <span>Target: {t.target}</span>
                                            </div>
                                        )}
                                         {t.task === "CLICK" && t.targetType === "coordinates" && (
                                            <div>
                                            <span> (X%: {t.details?.xPercent})</span>
                                            <br />
                                            <span> (Y%: {t.details.yPercent})</span>
                
                                            </div>
                                            )}
                                        </div>
                                    <div>
                                    <button onClick={() => moveTask(t.id, -1)} disabled={locked} className="move-up-button">Up</button>
                                    <button onClick={() => moveTask(t.id, 1)} disabled={locked} className="move-down-button">Down</button>
                                    <button onClick={() => openEditTask(t)} disabled={locked} className="edit-button">Edit</button>
                                    <button onClick={() => deleteTask(t.id)} disabled={locked} className="delete-button">Delete</button>
                                    </div>
                                    </div>
                                     )
                              )}
                        

                            {taskDescription && taskDescription.mode === "new" && (
                                <CreateTask
                                    taskDescription={taskDescription}
                                    tasks={tasks}
                                    onChangeText={(v) => setTaskDescription({ ...taskDescription, text:v })}
                                    onChangeTask={changeTaskType}
                                    onChangeDetail={onChangeDetail}
                                    onSave={saveTask}   
                                    onCancel={cancelTask}
                                    onChangeTargetType={changeTargetType}
                                    onChangeTarget={changeTarget}
                                    referenceImages={Notepad_Reference_Images}
                                />
                            )}
                        </div>
                        
                        <div className="footer-panel">
                            <button onClick={newDraft} className="confirm-button">Start new Draft</button>
                            <button onClick={useThisPlan} disabled={locked} className="confirm-button">Use this Plan</button>
                            {confirmOn ? (
                                <div className="confirm-dialog"> SAVED
                                <button onClick={handleUnlock} className="unlock-button">Edit</button>
                                </div>
                            ) : (
                                <button onClick={handleConfirm} disabled={locked} className="confirm-button">
                                    {locked ? 'Locked' : 'Save'}
                                </button>
                            )}
                        </div>
                    </div>  
                         ) : (
                                <div className="exit-message">
                                    <span>Are you sure you want to exit?</span>
                                    <button onClick={() => navigate("/Dashboard")} className="exit-button">Yes</button>
                                    <button onClick={() => setExit(false)}>Cancel</button>
                                </div>
                            )}
                        </div>
                             
            </div>
      );
}
