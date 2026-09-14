from pywinauto.application import Application
from pywinauto import Desktop

#Open notepad using UI Automation (uia) as the backend
Application(backend="uia").start(
    "notepad.exe",
    wait_for_idle=False
)

#Put all the information for the notepad window into a variable
notepad = Desktop(backend="uia").window(
    title="Untitled - Notepad"
)

#Wait for notepad to be open fully before executing code
notepad.wait("visible", timeout=10)

#Get the textEditor from the notepad window and make it into an object we can write into
textEditor = notepad.child_window(
    control_type="Document"
).wrapper_object()

#Write text into the textEditor
textEditor.type_keys(
    "Hello World",
    with_spaces=True
)