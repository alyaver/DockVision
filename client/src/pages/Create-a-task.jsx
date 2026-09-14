import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Create-a-task.css";
import Navigation from "../components/Navigation";

const Name_Task = "Name your Task Function";
const Default_Task = [];
const Task_Options = ["Type:", "Click"];

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

function CreateTask({taskDescription, tasks, onChangeText,onChangeDetail, onChangeTask, onSave, onCancel}) {
    const isClick = taskDescription.task === "Click";
    return (
        <div className="create-task-container">
            <TaskSelect value={taskDescription.task} tasks={tasks} onChange={(e) => onChangeTask(e.target.value)} />
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
            {isClick && (
                <div className="click-fields">
                    <input type="number" placeholder="Enter X coordinate" className="coordinate-input" value={taskDescription.details?.x ?? ""}
                    onChange={(e) => onChangeDetail("x", e.target.value) } />
                    <input type="number" placeholder="Enter Y coordinate" className="coordinate-input" value={taskDescription.details?.y ?? ""}
                    onChange={(e) => onChangeDetail("y", e.target.value) } />
                    <input type="number" placeholder="Click count" className="click-count-input" value={taskDescription.details?.count ?? ""}
                    onChange={(e) => onChangeDetail("count",e.target.value)}/>
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
    const [taskDescription, setTaskDescription] = useState({ text: "", task: "" });
    const [tasks, setTasks] = useState(Task_Options);
    const [newTaskName, setNewTaskName] = useState("");
    const [nextID, setNextID] = useState(1);
    const [defTask, setDefTask] = useState(Default_Task);
    const [locked, setLocked] = useState(false);
    const [confirmOn, setConfirmOn] = useState(null);
    const [exit, setExit] = useState(false);

    function openAddTask() {
        if(locked)  return;
        setTaskDescription({ mode: "new", text: "", task: "" });
    }

    function opendEditTask(t) {
        if(locked)  return;
        setTaskDescription({ mode: "edit", text: t.text, task: t.task, id: t.id, details: t.details || {} });
    }

    function cancelTask() {
        setTaskDescription(null);
    }

    function saveTask() {
        if(!taskDescription) return;
        if(taskDescription.mode === "new") {
            const newTask = { id: nextID, text: taskDescription.text, task: taskDescription.task, details: taskDescription.details || {} };
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


    function exportJson() {
        const dataStr = JSON.stringify(defTask, null, 2);
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
                                <div className="no-tasks-message">No tasks available. Click "Add Task" to create one.
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
                                         <span>{t.task}</span><span>{t.text}</span>
                                         {t.task === "Click" && t.details && (
                                            <div>
                                            <span> (X: {t.details.x})</span>
                                            <br />
                                            <span> (Y: {t.details.y})</span>
                                            <br />
                                            <span> (Count: {t.details.count})</span>
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
