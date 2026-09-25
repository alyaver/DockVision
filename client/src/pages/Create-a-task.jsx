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


function validateDraftTask(task) {
    const errors = {};

    if (!task.task) {
        errors.task = "Task type is required.";
    }

    if (task.task === "TYPE" && !task.text) {
        errors.text = "Text is required for TYPE task.";
    }

    if (task.task === "CLICK") {
        if (!task.details || task.details.x === undefined || task.details.y === undefined || task.details.x === "" || task.details.y === "") {
            errors.details = "X and Y coordinates are required for CLICK task.";
        }
    }
    return errors;
}

function CreateTask({taskDescription, tasks, onChangeText,onChangeDetail, onChangeTask, onSave, onCancel}) {
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
                    <input type="number" placeholder="Enter X coordinate" className="coordinate-input" value={taskDescription.details?.x ?? ""}
                    onChange={(e) => onChangeDetail("x", e.target.value) } />
                    <input type="number" placeholder="Enter Y coordinate" className="coordinate-input" value={taskDescription.details?.y ?? ""}
                    onChange={(e) => onChangeDetail("y", e.target.value) } />

                    {taskDescription.errors?.details && (
                        <p className="field-error">{taskDescription.errors.details}</p>
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
    const [taskDescription, setTaskDescription] = useState({ text: "", action: "" });
    const [tasks, setTasks] = useState(Task_Options);
    const [newTaskName, setNewTaskName] = useState("");
    const [nextID, setNextID] = useState(1);
    const [defTask, setDefTask] = useState(Default_Task);
    const [locked, setLocked] = useState(false);
    const [confirmOn, setConfirmOn] = useState(null);
    const [exit, setExit] = useState(false);
    const [createTaskError, setCreateTaskError] = useState(null);

    function openAddTask() {
        if(locked)  return;
        setTaskDescription({ mode: "new", task: "", text: "", details: {}, errors: {} });
    }

    function openEditTask(task) {
        if(locked)  return;
        setTaskDescription({ mode: "edit", id: task.id, text: task.text, task: task.task, details: task.details || {}, errors: {}, });
    }

    function changeTaskType(newType) {
        setTaskDescription({ ...taskDescription, task: newType, text: "", details: newType === "CLICK" ? { x: "", y: "" } : {}, errors: {} });
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
 
        const countInvalid = defTask.some((task) => {Object.keys(validateDraftTask(task)).length > 0});
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
            const newTask = { id: `step-${nextID}`, text: taskDescription.text, task: taskDescription.task, details: taskDescription.details || {} };
            setDefTask([...defTask, newTask]);
            setNextID(nextID + 1);
        } else if(taskDescription.mode === "edit") {
            setDefTask(defTask.map(t => t.id === taskDescription.id ? { ...t, text: taskDescription.text, task: taskDescription.task, details: taskDescription.details || {} } : t));
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


    function exportJson() { // Exports the task list to a JSON file
        if (!planValidation()) {
            return;
        }

        const stepsStr = JSON.stringify(defTask, null, 2);
        const dataStr =`"steps": ${stepsStr}`;
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
                                         {t.task === "CLICK" && t.details && (
                                            <div>
                                            <span> (X: {t.details.x})</span>
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
                                />
                            )}
                        </div>
                        
                        <div className="footer-panel">
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
