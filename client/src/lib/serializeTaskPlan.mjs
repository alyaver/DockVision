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


export function serializeTaskPlan(name, tasks) {
    return JSON.stringify({
        schemaVersion: "dockvision.user-task-plan.v1",
        name: name.trim() || "Untitled Task Plan",
        app: { name: "notepad", executable: "notepad.exe" },
        tasks: tasks.map(taskToSteps),
    }, null, 2);
}
