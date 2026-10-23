import notepadMainImage from "../assets/notepadReferences/Notepad-Main.png";
import notepadFileImage from "../assets/notepadReferences/Notepad-File.png";
import notepadEditImage from "../assets/notepadReferences/Notepad-Edit.png";
import notepadFormatImage from "../assets/notepadReferences/Notepad-Format.png";
import notepadViewImage from "../assets/notepadReferences/Notepad-View.png";
import notepadHelpImage from "../assets/notepadReferences/Notepad-Help.png";
import notepad_Edit_FindImage from "../assets/notepadReferences/Notepad-Edit-Find.png";
import notepad_Edit_GotoImage from "../assets/notepadReferences/Notepad-Edit-Goto.png";
import notepad_Edit_ReplaceImage from "../assets/notepadReferences/Notepad-Edit-Replace.png";
import notepad_Format_FontImage from "../assets/notepadReferences/Notepad-Format-Font.png";
import notepad_File_OpenImage from "../assets/notepadReferences/Notepad-File-Open.png";
import notepad_File_SaveAsImage from "../assets/notepadReferences/Notepad-File-Saveas.png";
import notepad_file_pageSetupImage from "../assets/notepadReferences/Notepad-File-PageSetup.png";
import notepad_file_printImage from "../assets/notepadReferences/Notepad-File-Print.png";
import notepad_help_aboutImage from "../assets/notepadReferences/Notepad-Help-About.png";

export const Notepad_Reference_Images = [
    {
            id: "notepad_screen_main",
            label: "Notepad Editor",
            menuID: ["editor"],
            src: notepadMainImage,
            width: 945,
            height: 540,
        },
        {
            id: "notepad_screen_file_menu",
            label: "Notepad File Menu",
            menuID: ["file"],
            src: notepadFileImage,
            width: 943,
            height: 540,
        },
        {
            id: "notepad_screen_edit_menu",
            label: "Notepad Edit Menu",
            menuID: ["edit"],
            src: notepadEditImage,
            width: 943,
            height: 540,
        },
        {
            id: "notepad_screen_format_menu",
            label: "Notepad Format Menu",
            menuID: ["format"],
            src: notepadFormatImage,
            width: 943,
            height: 538,
        },
        {
            id: "notepad_screen_view_menu",
            label: "Notepad View Menu",
            menuID: ["view"],
            src: notepadViewImage,
            width: 943,
            height: 540,
        },
        {
            id: "notepad_screen_help_menu",
            label: "Notepad Help Menu",
            menuID: ["help"],
            src: notepadHelpImage,
            width: 943,
            height: 540,
        },
        {
            id: "notepad_screen_edit_find",
            label: "Notepad Edit Find",
            menuID: ["edit"],
            kind: "submenu",
            src: notepad_Edit_FindImage,
            width: 943,
            height: 540,
        },
        {
            id: "notepad_screen_edit_goto",
            label: "Notepad Edit Goto",
            menuID: ["edit"],
            kind: "submenu",
            src: notepad_Edit_GotoImage,
            width: 943,
            height: 538,
        },
        {
            id: "notepad_screen_edit_replace",
            label: "Notepad Edit Replace",
            menuID: ["edit"],
            kind: "submenu",
            src: notepad_Edit_ReplaceImage,
            width: 943,
            height: 538,
        },
        {
            id: "notepad_screen_format_font",
            label: "Notepad Format Font",
            menuID: ["format"],
            kind: "submenu",
            src: notepad_Format_FontImage,
            width: 943,
            height: 621,
        },
        {
            id: "notepad_screen_file_open",
            label: "Notepad File Open",
            menuID: ["file"],
            kind: "submenu",
            src: notepad_File_OpenImage,
            width: 943,
            height: 540,
        },
        {
            id: "notepad_screen_file_saveas",
            label: "Notepad File Save As",
            menuID: ["file"],
            kind: "submenu",
            src: notepad_File_SaveAsImage,
            width: 945,
            height: 540,
        },
        {
            id: "notepad_screen_file_pagesetup",
            label: "Notepad File Page Setup",
            menuID: ["file"],
            kind: "submenu",
            src: notepad_file_pageSetupImage,
            width: 943,
            height: 538,
        },
        {
            id: "notepad_screen_file_print",
            label: "Notepad File Print",
            menuID: ["file"],
            kind: "submenu",
            src: notepad_file_printImage,
            width: 942, 
            height: 538,
        },
        {
            id: "notepad_screen_help_about",
            label: "Notepad Help About",
            menuID: ["help"],
            kind: "submenu",
            src: notepad_help_aboutImage,
            width: 945,
            height: 538,
        }
]

export const notepadMenus = [
    { id: "editor", label: "Editor", defaultReferenceImageId: "notepad_screen_main" },
    { id: "file", label: "File", defaultReferenceImageId: "notepad_screen_file_menu" },
    { id: "edit", label: "Edit", defaultReferenceImageId: "notepad_screen_edit_menu" },
    { id: "format", label: "Format", defaultReferenceImageId: "notepad_screen_format_menu" },
    { id: "view", label: "View", defaultReferenceImageId: "notepad_screen_view_menu" },
    { id: "help", label: "Help", defaultReferenceImageId: "notepad_screen_help_menu" }
];

export function getReferenceMenu(menuID, referenceImages = Notepad_Reference_Images) {
    return referenceImages.filter((image) => image.menuID.includes(menuID));
}