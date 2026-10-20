import notepadMainImage from "../assets/notepadReferences/Notepad-Main.png";
import notepadFileImage from "../assets/notepadReferences/Notepad-File.png";
import notepadEditImage from "../assets/notepadReferences/Notepad-Edit.png";
import notepadFormatImage from "../assets/notepadReferences/Notepad-Format.png";
import notepadViewImage from "../assets/notepadReferences/Notepad-View.png";
import notepadHelpImage from "../assets/notepadReferences/Notepad-Help.png";

export const Notepad_Reference_Images = [
    {
            id: "notepad_screen_main",
            label: "Notepad Editor",
            menuID: ["editor"],
            src: notepadMainImage,
            width: 942,
            height: 490,
        },
        {
            id: "notepad_screen_file_menu",
            label: "Notepad File Menu",
            menuID: ["file"],
            src: notepadFileImage,
            width: 943,
            height: 489,
        },
        {
            id: "notepad_screen_edit_menu",
            label: "Notepad Edit Menu",
            menuID: ["edit"],
            src: notepadEditImage,
            width: 943,
            height: 490,
        },
        {
            id: "notepad_screen_format_menu",
            label: "Notepad Format Menu",
            menuID: ["format"],
            src: notepadFormatImage,
            width: 942,
            height: 492,
        },
        {
            id: "notepad_screen_view_menu",
            label: "Notepad View Menu",
            menuID: ["view"],
            src: notepadViewImage,
            width: 943,
            height: 492,
        },
        {
            id: "notepad_screen_help_menu",
            label: "Notepad Help Menu",
            menuID: ["help"],
            src: notepadHelpImage,
            width: 943,
            height: 490,
        }
]

export function getReferenceMenu(menuID) {
    const menuImages = Notepad_Reference_Images.filter((image) => image.menuID.includes(menuID));
    return menuImages;
}