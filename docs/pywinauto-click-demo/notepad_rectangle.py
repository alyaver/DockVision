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

#Find the control identifier (information) for the File button in the menu and make it into an object
menuFile = notepad.child_window(title="File", control_type="MenuItem").wrapper_object()

#Get the position of the File menu button
filePos = menuFile.rectangle()

#Print the position of the button
print(filePos)