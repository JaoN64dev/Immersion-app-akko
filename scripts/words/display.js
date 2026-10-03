// Furigana mode, word colouring and grammar underlines, shared by every page (saved in "akko-settings")

import { store } from "../core/utils.js";

const KEY = "akko-settings";

export function wordDisplay() {
    const s = store.get(KEY, {});
    return { furigana: s.furigana || "unknown", colors: s.colors ?? true, grammar: s.grammar ?? true };
}

// furigana: always | unknown (only on words you don't know) | hover | off
export function applyWordDisplay() {
    const d = wordDisplay();
    document.body.dataset.furigana = d.furigana;
    document.body.classList.toggle("color-words", d.colors);
    document.body.classList.toggle("grammar-marks", d.grammar);
}

// Wire a furigana <select> and a colour checkbox (and the page's #grammar-marks checkbox, if it has one)
export function bindWordDisplay(select, checkbox) {
    const grammar = document.getElementById("grammar-marks");
    const d = wordDisplay();
    select.value = d.furigana;
    checkbox.checked = d.colors;
    if (grammar) grammar.checked = d.grammar;
    const save = () => {
        const s = { ...store.get(KEY, {}), furigana: select.value, colors: checkbox.checked };
        if (grammar) s.grammar = grammar.checked;
        store.set(KEY, s);
        applyWordDisplay();
    };
    select.addEventListener("input", save);
    checkbox.addEventListener("input", save);
    if (grammar) grammar.addEventListener("input", save);
    applyWordDisplay();
}
