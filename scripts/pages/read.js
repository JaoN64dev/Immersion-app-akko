// 読む Read page (reading.html): texts/books + manga

import { $ } from "../core/dom.js";
import * as popup from "../popup.js";
import { initKeys } from "../keys.js";
import { remindBackup } from "../core/reminder.js";
import { readTextFile, splitParagraphs } from "../reader/import.js";
import { addText, getText, removeText, renderLibrary } from "../reader/library.js";
import * as reader from "../reader/text.js";
import * as manga from "../reader/manga.js";

const ui = {
    textMode: $("#text-mode"), mangaMode: $("#manga-mode"),
    library: $("#library"), librarySection: $("#library-section"), status: $("#library-status"),
    pasteOpen: $("#paste-open"), pasteForm: $("#paste-form"), pasteTitle: $("#paste-title"),
    pasteText: $("#paste-text"), pasteCancel: $("#paste-cancel"), textFile: $("#text-file"),
    mangaFiles: $("#manga-files"), mangaFolder: $("#manga-folder"),
};

// ---------- text / manga switch (remembered in the address: #manga) ----------

function setMode(mode) {
    const isManga = mode === "manga";
    ui.textMode.hidden = isManga;
    ui.mangaMode.hidden = !isManga;
    document.querySelectorAll(".mode-switch [data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    history.replaceState(null, "", isManga ? "#manga" : location.pathname);
}
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.querySelectorAll("[data-mode-link]").forEach((a) => a.addEventListener("click", () => setMode(a.dataset.modeLink)));
setMode(location.hash === "#manga" ? "manga" : "text");

// ---------- library ----------

function showLibrary() {
    ui.librarySection.hidden = false;
    renderLibrary(ui.library, {
        onOpen: async (id) => open(await getText(id)),
        onDelete: async (id, title) => {
            if (!confirm(`delete “${title}” from the library?`)) return;
            await removeText(id);
            showLibrary();
        },
    });
}

function open(text) {
    ui.librarySection.hidden = true;
    reader.openText(text);
    document.getElementById("reader-section").scrollIntoView({ behavior: "smooth" });
}

ui.pasteOpen.addEventListener("click", () => {
    ui.pasteForm.hidden = !ui.pasteForm.hidden;
    if (!ui.pasteForm.hidden) ui.pasteText.focus();
});
ui.pasteCancel.addEventListener("click", () => { ui.pasteForm.hidden = true; });
ui.pasteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const paragraphs = splitParagraphs(ui.pasteText.value);
    if (!paragraphs.length) return;
    const title = ui.pasteTitle.value.trim() || paragraphs[0].slice(0, 20);
    const text = await addText(title, paragraphs);
    ui.pasteForm.hidden = true;
    ui.pasteText.value = ui.pasteTitle.value = "";
    open(text);
});

ui.textFile.addEventListener("change", async () => {
    const file = ui.textFile.files[0];
    ui.textFile.value = "";
    if (!file) return;
    ui.status.textContent = `reading ${file.name}…`;
    try {
        const { title, paragraphs } = await readTextFile(file);
        ui.status.textContent = "";
        open(await addText(title, paragraphs));
    } catch (err) {
        ui.status.textContent = `couldn't read ${file.name}: ${err.message}`;
    }
});

// ---------- manga ----------

for (const input of [ui.mangaFiles, ui.mangaFolder]) {
    input.addEventListener("change", () => {
        if (input.files.length) manga.openFiles(input.files, { picker: input === ui.mangaFolder ? "folder" : "files" });
        input.value = "";
    });
}

// ---------- shared ----------

popup.init();
reader.init({ onBack: showLibrary });
manga.init();
showLibrary();

const inManga = () => !ui.mangaMode.hidden;
initKeys({
    arrowleft: () => inManga() && manga.nextPage(),      // manga reads right-to-left
    arrowright: () => inManga() && manga.prevPage(),
    t: () => inManga() && manga.toggleText(),
    "+": () => inManga() && manga.zoomIn(),
    "=": () => inManga() && manga.zoomIn(),
    "-": () => inManga() && manga.zoomOut(),
    "0": () => inManga() && manga.resetZoom(),
});

remindBackup();
