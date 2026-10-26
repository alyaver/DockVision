// gets tasks from user input and puts them into a JSON step format
function taskToSteps(task, referenceImages) {
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
        const details = task.details || {};
        const referenceImageId = details.referenceImageId ?? details.referenceImageID;

        let target = {
            type: "namedControl",
            name: "editor",
            xPercent: Number(details.xPercent),
            yPercent: Number(details.yPercent),
        };     
        if (referenceImageId) {
            const referenceImage = referenceImages.find(img => img.id === referenceImageId);         
            if (!referenceImage) {
                throw new Error(`Reference image with ID ${referenceImageId} not found.`);
            }

            target = {
                type: "windowPoint",
                x: percentToPixel(details.xPercent, referenceImage.width),
                y: percentToPixel(details.yPercent, referenceImage.height),
            }
        }
        return {
            id: task.id,
            action: "CLICK",
            target,
            button: "left",
            clickCount: 1,
        };
    }
    return task
}

function percentToPixel(percent, dimension) { // Convert a percentage to a pixel value based on the dimension
    const pixel = Math.round(Number(percent) * dimension / 100);
    return Math.min(pixel, dimension - 1);
}

export function serializeTaskPlan(name, tasks, referenceImages = []) {
    return JSON.stringify({
        schemaVersion: "dockvision.user-task-plan.v1",
        name: name.trim() || "Untitled Task Plan",
        app: { name: "notepad", executable: "notepad.exe" },
        tasks: tasks.map((task) => taskToSteps(task, referenceImages)),
    }, null, 2);
}
