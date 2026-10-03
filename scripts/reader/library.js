// Saved texts (IndexedDB "texts"): {id, title, paragraphs, chars, position, pct, lang, created, updated}
// Where you are in each text and how much of it you know live apart, in "akko-reading"
// ({textId: {position, pct, updated}}): IndexedDB rewrites a record whole, so saving the
// position into the text itself while scrolling meant rewriting the entire book every time.

import { idbAll, idbGet, idbPut, idbDelete } from "../core/idb.js";
import { store, escapeHtml } from "../core/utils.js";
import { pctLevel } from "../words/status.js";
import { target, ofTarget, understood } from "../core/target.js";

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));

export async function addText(title, paragraphs) {
    const now = Date.now();
    const rec = {
        id: newId(), title: title || "untitled", paragraphs,
        chars: paragraphs.reduce((n, p) => n + p.length, 0),
        position: 0, pct: null, lang: target(), created: now, updated: now,
    };
    await idbPut("texts", rec);
    return rec;
}

export const getText = (id) => idbGet("texts", id);

const READING = "akko-reading";

// {position, pct, updated} of a text (texts saved by older versions kept them on the record)
export const readingOf = (t) => ({ position: t.position || 0, pct: t.pct ?? null, updated: t.updated, ...(store.get(READING, {})[t.id] || {}) });

export function saveReading(id, fields) {
    const all = store.get(READING, {});
    all[id] = { ...all[id], ...fields, updated: Date.now() };
    store.set(READING, all);
}

export async function removeText(id) {
    await idbDelete("texts", id);
    const all = store.get(READING, {});
    if (all[id]) { delete all[id]; store.set(READING, all); }
}

export async function renderLibrary(list, { onOpen, onDelete }) {
    const texts = (await idbAll("texts")).filter(ofTarget).sort((a, b) => readingOf(b).updated - readingOf(a).updated);
    if (!texts.length) {
        list.innerHTML = `<li class="empty">nothing here yet. paste some text or open a book (.epub / .txt).</li>`;
        return;
    }
    list.innerHTML = texts.map((t) => {
        const { position, pct } = readingOf(t);
        const read = t.paragraphs.length > 1 ? Math.round((position / (t.paragraphs.length - 1)) * 100) : 0;
        return `<li class="note library-item" data-id="${escapeHtml(t.id)}">
            <div class="library-main">
                <b lang="${target()}">${escapeHtml(t.title)}</b>
                <span class="library-meta">${t.chars.toLocaleString()} characters · ${t.paragraphs.length.toLocaleString()} paragraphs
                    ${pct != null ? ` · <span class="pct ${pctLevel(pct)}">${pct}% ${understood()}</span>` : ""}</span>
                <div class="bar" title="${read}% read"><i style="width:${read}%"></i></div>
            </div>
            <button class="open">read</button>
            <button class="remove" title="delete">✕</button>
        </li>`;
    }).join("");
    list.onclick = (e) => {
        const item = e.target.closest(".library-item");
        if (!item) return;
        if (e.target.closest(".remove")) onDelete(item.dataset.id, item.querySelector("b").textContent);
        else onOpen(item.dataset.id);
    };
}
