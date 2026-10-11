// Keyboard shortcuts. Every page gets 1-4 (word status) and Esc (close popup);
// pages add their own keys.

import { STATUSES } from "./words/status.js";
import { hovered, setHoveredStatus } from "./words/hover.js";
import { isOpen, setPopupStatus, closePopup } from "./popup.js";

// Typing in a text box, picking in a dropdown or dragging a slider keeps its keys.
// (Checkboxes and buttons don't, or ticking "two pages" would kill the arrow keys.)
const keepsKeys = (t) => t.matches("textarea, select, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=file])");

// pageKeys: { key (lowercase, " " for space): (event) => void }
export function initKeys(pageKeys = {}) {
    document.addEventListener("keydown", (e) => {
        if (keepsKeys(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();

        // 1-4: status of the popup's word, or of the word under the mouse (with neither, the page
        // may use them: the listening page picks an answer)
        if (["1", "2", "3", "4"].includes(k)) {
            const status = STATUSES[Number(k) - 1][0];
            if (isOpen()) setPopupStatus(status);
            else if (hovered()) setHoveredStatus(status);
            else if (pageKeys[k]) pageKeys[k](e);
            return;
        }
        if (k === "escape") { closePopup(); return; }
        if (pageKeys[k]) pageKeys[k](e);
    });
}
