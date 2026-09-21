import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Create-a-task.css";
import Navigation from "../components/Navigation";

const Name_Task = "Name your Task Function";
const Default_Task = [];
const Task_Options = ["TYPE", "CLICK"];
const Target_Type_Options = ["Named Control", "Screen Point", "Window Point"];
const Named_Control_Options = [
    { label: "Editor", value: "editor" },
    { label: "File Menu", value: "fileMenu" },
    { label: "Edit Menu", value: "editMenu" },
    { label: "Format Menu", value: "formatMenu" },
    { label: "View Menu", value: "viewMenu" },
    { label: "Help Menu", value: "helpMenu" },
];
const Mouse_Button_Options = [
    { label: "Left", value: "left" },
    { label: "Right", value: "right" },
];

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

function TargetTypeSelect({value, onChange}) {
return (
  <select value={value} onChange={onChange} className="target-type-select">
    <option value="">Select a target type</option>
    {Target_Type_Options.map((c) => (
      <option key={c} value={c}>
        {c}
      </option>
    ))}
  </select>
);
}

function NamedControlSelect({value, onChange}) {
return (
  <select value={value} onChange={onChange} className="control-name-select">
    <option value="">Select a control</option>
    {Named_Control_Options.map((c) => (
      <option key={c.value} value={c.value}>
        {c.label}
      </option>
    ))}
  </select>
);
}

function MouseButtonSelect({value, onChange}) {
return (
  <select value={value} onChange={onChange} className="mouse-button-select">
    {Mouse_Button_Options.map((c) => (
      <option key={c.value} value={c.value}>
        {c.label}
      </option>
    ))}
  </select>
);
}

function CreateTask({taskDescription, tasks, onChangeText,onChangeDetail, onChangeTask, onSave, onCancel}) {
    const isClick = taskDescription.task === "CLICK";
    const isTyped = taskDescription.task === "TYPE";
    const targetType = taskDescription.details?.targetType ?? "";
    const isNamedControl = targetType === "Named Control";
    const isPointTarget = targetType === "Screen Point" || targetType === "Window Point";
    return (
        <div className="create-task-container">
            <TaskSelect value={taskDescription.task} tasks={tasks} onChange={(e) => onChangeTask(e.target.value)} />
           {isTyped && (
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
            )}

            {isClick && (
                <div className="click-fields">
                    <TargetTypeSelect value={targetType} onChange={(e) => onChangeDetail("targetType", e.target.value)} />

                    {isNamedControl && (
                        <NamedControlSelect value={taskDescription.details?.controlName ?? ""}
                        onChange={(e) => onChangeDetail("controlName", e.target.value) } />
                    )}

                    {isPointTarget && (
                        <>
                            <input type="number" placeholder="Enter X coordinate" className="coordinate-input" value={taskDescription.details?.x ?? ""}
                            onChange={(e) => onChangeDetail("x", e.target.value) } />
                            <input type="number" placeholder="Enter Y coordinate" className="coordinate-input" value={taskDescription.details?.y ?? ""}
                            onChange={(e) => onChangeDetail("y", e.target.value) } />
                        </>
                    )}

                    {(isNamedControl || isPointTarget) && (
                        <>
                            <MouseButtonSelect value={taskDescription.details?.button ?? "left"}
                            onChange={(e) => onChangeDetail("button", e.target.value) } />
                            <input type="number" placeholder="Enter click count" className="click-count-input" min="1" max="2" step="1"
                            value={taskDescription.details?.clickCount ?? 1}
                            onChange={(e) => onChangeDetail("clickCount", e.target.value) } />
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
    const [taskDescription, setTaskDescription] = useState({ text: "", action: "" });
    const [tasks, setTasks] = useState(Task_Options);
    const [newTaskName, setNewTaskName] = useState("");
    const [nextID, setNextID] = useState(1);
    const [defTask, setDefTask] = useState(Default_Task);
    const [locked, setLocked] = useState(false);
    const [confirmOn, setConfirmOn] = useState(null);
    const [exit, setExit] = useState(false);

    function openAddTask() {
        if(locked)  return;
        setTaskDescription({ mode: "new", text: "", action: "" });
    }

    function opendEditTask(t) {
        if(locked)  return;
        setTaskDescription({ mode: "edit", text: t.text, action: t.task, id: t.id, details: t.details || {} });
    }

    function cancelTask() {
        setTaskDescription(null);
    }

    function saveTask() {
        if(!taskDescription) return;
        if(taskDescription.mode === "new") {
            const newTask = { id: `step-${nextID}`, text: taskDescription.text, action: taskDescription.task, details: taskDescription.details || {} };
            setDefTask([...defTask, newTask]);
            setNextID(nextID + 1);
        } else if(taskDescription.mode === "edit") {
            setDefTask(defTask.map(t => t.id === taskDescription.id ? { ...t, text: taskDescription.text, action: taskDescription.task, details: taskDescription.details || {} } : t));
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


    function exportJson() {
        const exportedTasks = defTask.map((t) => {
            if (t.action === "CLICK") {
                const targetType = t.details?.targetType;
                if (targetType === "Named Control") {
                    return {
                        id: `click-${t.details?.controlName}`,
                        action: t.action,
                        target: t.details?.controlName,
                        button: t.details?.button ?? "left",
                        clickCount: Number(t.details?.clickCount ?? 1),
                    };
                }
                return {
                    id: "click-position",
                    action: t.action,
                    target: {
                        type: targetType === "Window Point" ? "windowPoint" : "screenPoint",
                        x: Number(t.details?.x),
                        y: Number(t.details?.y),
                    },
                    button: t.details?.button ?? "left",
                    clickCount: Number(t.details?.clickCount ?? 1),
                };
            }
            return { id: "enter-text", action: t.action, text: t.text };
        });
        const exportedPlan = {
            schemaVersion: "dockvision.user-task-plan.v1",
            name: "Notepad typing test",
            app: {
                name: "notepad",
                executable: "notepad.exe",
                fileName: "typing-test.txt",
                uniqueFilePerRun: true,
                resetFile: true,
            },
            settings: {
                stepDelayMs: 250,
                typingDelayMs: 25,
                timeoutSeconds: 20,
            },
            tasks: exportedTasks,
        };
        const dataStr = JSON.stringify(exportedPlan, null, 2);
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
                                        onChangeTask={(v) => setTaskDescription({ ...taskDescription, task:v })}
                                        onChangeDetail={onChangeDetail}
                                        onSave={saveTask}
                                        onCancel={cancelTask} 
                                    />
                                ) : (
                                    <div key={t.id} className="task-item">
                                        <div>
                                         <span>{t.action}</span><span>{t.text}</span>
                                         {t.action === "CLICK" && t.details && (
                                            <div>
                                            {t.details.targetType === "Named Control" ? (
                                                <span> (Control: {t.details.controlName})</span>
                                            ) : (
                                                <>
                                                <span> (X: {t.details.x})</span>
                                                <br />
                                                <span> (Y: {t.details.y})</span>
                                                </>
                                            )}
                                            <br />
                                            <span> (Button: {t.details.button ?? "left"})</span>
                                            <br />
                                            <span> (Click Count: {t.details.clickCount ?? 1})</span>
                                            </div>
                                            )}
                                        </div>
                                    <div>
                                    <button onClick={() => opendEditTask(t)} disabled={locked} className="edit-button">Edit</button>
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
                                    onChangeTask={(v) => setTaskDescription({ ...taskDescription, task:v })}
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
