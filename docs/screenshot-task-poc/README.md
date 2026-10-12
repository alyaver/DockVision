# Screenshot Task Proof of Concept

This proof of concept shows that taking a screenshot as a task, similar to type and click, can be done in a python script using a JSON
file as the task supplier. This proof of concept will require the python dependency, pillow, that works well with pywinauto to capture
the full screen.

1. Run "pip install pillow"
2. Run "python screenshot-task-runner.py"

There should be 3 screenshots made according to the screenshot-task-plan.json file.
The file names will be:
    1. before-typing.png
    2. after-typing.png
    3. menu-click.png

The files will be put into a folder test-screenshot-pngs in the same directory as the script.