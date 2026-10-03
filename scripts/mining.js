// Mined words: saved from any page into IndexedDB ("mined"), so there's no practical size
// limit. The list, .tsv export and "→ Anki" buttons live on the Watch page (initList);
// other pages only add to it. Older versions kept the list in localStorage ("akko-mined");
// it's moved over once, automatically.

import { $ } from "./core/dom.js";
import { store, escapeHtml, download } from "./core/utils.js";
import { idbAll, idbPut, idbPutMany, idbDelete, idbReplace } from "./core/idb.js";
import * as anki from "./anki/client.js";
import { t } from "./i18n.js";
import { target, ofTarget } from "./core/target.js";

const OLD_KEY = "akko-mined";
const PAGE = 100;                  // cards drawn at a time on the Watch page

// newest first; filled by loadMined()
export const mined = [];
let loaded = null;
let shown = PAGE;

// tell other open pages when the list changes (IndexedDB has no "storage" event)
const channel = "BroadcastChannel" in window ? new BroadcastChannel("akko-mined") : null;
const announce = () => channel && channel.postMessage("changed");

const newId = (added) => `${added}-${Math.random().toString(36).slice(2, 8)}`;

// One-time move from localStorage, then read everything
async function readAll() {
    const old = store.get(OLD_KEY, null);
    if (Array.isArray(old) && old.length) {
        // fixed ids: if two tabs migrate at once, the second just overwrites the same cards
        await idbPutMany("mined", old.map((m, i) => ({ ...m, id: m.id || `old-${m.added || 0}-${i}` })));
    }
    if (old !== null) store.remove(OLD_KEY);
    // only the words of the language being learnt (scripts/core/target.js)
    return (await idbAll("mined")).filter(ofTarget).sort((a, b) => b.added - a.added);
}

export function loadMined() {
    if (!loaded) {
        loaded = readAll().then((list) => { mined.splice(0, mined.length, ...list); return mined; });
    }
    return loaded;
}

async function reload() {
    loaded = null;
    await loadMined();
    renderMined();
}

// Save changes to one card (e.g. its Anki note id)
export async function saveItem(item) {
    await idbPut("mined", item);
    announce();
}

// Save a dictionary entry with the sentence it came from; sends it to Anki if that's on.
// ctx = {word (as clicked), sentence, info: {source, time, videoName, cueStart, cueEnd}, media}
// Resolves to whether Anki got it.
export async function mine(entry, ctx) {
    await loadMined();
    const info = ctx.info || {};
    const added = Date.now();
    const item = {
        id: newId(added),
        word: entry.word,
        reading: entry.reading,
        forms: entry.forms || [],          // other spellings, for finding word audio
        pitch: ((entry.pitch || []).find((p) => p.reading === entry.reading) || {}).accents || [],
        meaning: entry.senses.slice(0, 3).map((s) => s.gloss.join("; ")).join(" / "),
        surface: ctx.word || "",
        sentence: ctx.sentence || "",
        source: info.source || "",
        time: info.time || "",
        videoName: info.videoName || "",
        cueStart: info.cueStart ?? null,
        cueEnd: info.cueEnd ?? null,
        translation: info.translation || "",
        lang: target(),
        added,
    };
    mined.unshift(item);
    renderMined();
    try { await saveItem(item); } catch { /* warned already; it stays in this page's list */ }
    return anki.auto() ? anki.send(item, ctx.media) : false;
}

// ---------- the list (Watch page) ----------

const list = $("#mined");
const count = $("#mined-count");
const more = $("#mined-more");

export function renderMined() {
    if (!list) return;
    count.textContent = mined.length ? `(${mined.length})` : "";
    list.innerHTML = mined.length ? mined.slice(0, shown).map((m, i) => `
        <li class="note">
            <div class="mined-head">
                <span class="headword">${escapeHtml(m.word)}</span>
                <span class="reading">${escapeHtml(m.reading)}</span>
                ${m.ankiNoteId
                    ? `<span class="in-anki" title="note ${m.ankiNoteId}">✓ Anki</span>`
                    : `<button class="to-anki" data-i="${i}" title="send this card to Anki">→ Anki</button>`}
                <button class="remove" data-i="${i}" title="remove">✕</button>
            </div>
            <p class="meaning">${escapeHtml(m.meaning)}</p>
            ${m.sentence ? `<p class="sentence">${escapeHtml(m.sentence).replace(escapeHtml(m.word), `<mark>${escapeHtml(m.word)}</mark>`)}</p>` : ""}
            ${m.source ? `<p class="source">${escapeHtml(m.source)} ${escapeHtml(m.time)}</p>` : ""}
        </li>`).join("") : `<li class="empty">nothing yet — click a word in the subtitles and hit “+ mine”.</li>`;
    more.hidden = mined.length <= shown;
    more.textContent = `show more (${mined.length - shown} older)`;
}

// Tab-separated: word, reading, meaning, sentence, source — imports cleanly into Anki
function exportTsv() {
    if (!mined.length) return;
    const clean = (s) => String(s || "").replace(/[\t\n\r]+/g, " ");
    const tsv = mined.map((m) => [m.word, m.reading, m.meaning, m.sentence, `${m.source} ${m.time}`].map(clean).join("\t")).join("\n");
    download("akko-mined.tsv", tsv, "text/tab-separated-values");
}

// Where "→ Anki" on an old card gets audio/screenshot from (set by the Watch page)
let mediaFor = () => null;

export function initList({ media } = {}) {
    if (media) mediaFor = media;
    list.addEventListener("click", async (e) => {
        const item = mined[Number(e.target.dataset.i)];
        if (!item) return;
        if (e.target.classList.contains("to-anki")) {
            e.target.disabled = true;
            e.target.textContent = "sending…";
            await anki.send(item, mediaFor(item));
            renderMined();
        } else if (e.target.classList.contains("remove")) {
            mined.splice(mined.indexOf(item), 1);
            renderMined();
            await idbDelete("mined", item.id).catch(() => {});
            announce();
        }
    });
    $("#clear-mined").addEventListener("click", async () => {
        if (!mined.length || !confirm(t(`delete all ${mined.length} mined words?`))) return;
        mined.length = 0;
        renderMined();
        // keep the other language's words
        await idbAll("mined").then((all) => idbReplace("mined", all.filter((m) => !ofTarget(m)))).catch(() => {});
        announce();
    });
    more.addEventListener("click", () => { shown += PAGE; renderMined(); });
    $("#export-csv").addEventListener("click", exportTsv);
    if (channel) channel.onmessage = reload;      // mined on another page
    loadMined().then(renderMined);
}
