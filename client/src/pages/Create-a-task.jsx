import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Create-a-task.css";
import Navigation from "../components/Navigation";

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

function  TaskSelect({value, tasks, onChange}) {
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

// gets tasks from user input and puts them into a JSON step format
function taskToSteps(task) {
    if (task.task === "TYPE") {
        return {
            id: task.id,
            action: "TYPE",
            text: task.text,
        };
    }

    if (task.task === "CLICK" && task.targetType === "named") {
        return {
            id: task.id,
            action: "CLICK",
            target: task.target,
            button: "left",
            clickCount: 1
        };
    } 

    if (task.task === "CLICK" && task.targetType === "coordinates") {
        return {
            id: task.id,
            action: "CLICK",
            target: {
                type: "screenPoint",
                x: Number(task.details?.x),
                y: Number(task.details?.y),
            },
            button: "left",
            clickCount: 1,
        };
    }
    return task
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
            if (!task.details || task.details.x === undefined || task.details.y === undefined || task.details.x === "" || task.details.y === "") {
                errors.details = "X and Y coordinates are required for CLICK task.";
            }
        }
    }
    return errors;
}

function CreateTask({taskDescription, tasks, onChangeText,onChangeDetail, onChangeTask, onSave, onCancel, onChangeTargetType, onChangeTarget}) {
    const isClick = taskDescription.task === "CLICK";
    const isTyped = taskDescription.task === "TYPE";
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
                        <>
                            <input type="number" placeholder="Enter X coordinate" className="coordinate-input" value={taskDescription.details?.x ?? ""}
                            onChange={(e) => onChangeDetail("x", e.target.value) } />
                            <input type="number" placeholder="Enter Y coordinate" className="coordinate-input" value={taskDescription.details?.y ?? ""}
                            onChange={(e) => onChangeDetail("y", e.target.value) } />

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
        setTaskDescription({ ...taskDescription, task: newType, text: "", details: newType === "CLICK" ? { x: "", y: "" } : {}, targetType: newType === "CLICK" ? "named" : "", target: newType === "CLICK" ? "editor" : "", errors: {} });
    }

    function changeTargetType(targetType) { // // When selecting CLICK task, switch between coordinates and named target types
        setTaskDescription({ ...taskDescription, targetType: targetType, target: targetType === "named" ? "editor" : "", details: targetType === "coordinates" ? { x: "", y: "" } : {}, errors: {} });
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
        const errors = validateDraftTask(taskDescription);
        if (Object.keys(errors).length > 0) { // If there are validation errors, set the errors in the taskDescription state and return
            setTaskDescription({ ...taskDescription, errors });
            return;
        }
        if(taskDescription.mode === "new") {
            const newTask = { id: `step-${nextID}`, text: taskDescription.text, task: taskDescription.task, details: taskDescription.details || {}, targetType: taskDescription.targetType, target: taskDescription.target};
            setDefTask([...defTask, newTask]);
            setNextID(nextID + 1);
        } else if(taskDescription.mode === "edit") {
            setDefTask(defTask.map(t => t.id === taskDescription.id ? { ...t, text: taskDescription.text, task: taskDescription.task, details: taskDescription.details || {}, targetType: taskDescription.targetType, target: taskDescription.target } : t));
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
        setTaskDescription({ ...taskDescription, details: { ...taskDescription.details, [key]: value } });
    }

    function buildPlan() {
        const plan = {
            schemaVersion: "dockvision.plan.v1",
            name: newTaskName.trim() || "Untitled Task Plan",
            app: {
                name: "notepad",
                executable: "notepad.exe",
            },
            steps: defTask.map(taskToSteps),
        }

        return JSON.stringify(plan, null, 2);
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
                                            <span> (X: {t.details?.x})</span>
                                            <br />
                                            <span> (Y: {t.details.y})</span>
                
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
