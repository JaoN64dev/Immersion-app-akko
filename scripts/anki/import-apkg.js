// Known words from an Anki file (3.0, feature 12, the import half): an .apkg or .colpkg exported
// from Anki, read in the browser — no AnkiConnect, Anki doesn't need to be open. Each note's word
// (the field named like one, else the first) becomes known when one of its cards is mature
// (interval ≥ 21 days), learning otherwise; a word you already marked known or ignored stays so.
//
// Two layouts exist: the older collection.anki2 / .anki21 (plain SQLite, note types in col.models)
// and, since Anki 2.1.50, collection.anki21b (zstd-compressed SQLite, note types in their own
// tables). A new-style file also carries a stub collection.anki2 that only says "please update
// Anki", so the newest layout present wins.

import { loadScript } from "../core/utils.js";
import { getJSZip } from "../reader/import.js";
import { setWordStatus, saveWords } from "../words/status.js";
import { getSql } from "./apkg.js";
import { cleanWord, wordFieldIndex, statusOf } from "./schedule.js";

const FZSTD = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js";

async function unzstd(bytes) {
    await loadScript(FZSTD);
    return window.fzstd.decompress(bytes);
}

// the SQLite inside the file, newest layout first
async function collectionOf(file) {
    const zip = await (await getJSZip()).loadAsync(file);
    const newer = zip.file("collection.anki21b");
    if (newer) return unzstd(new Uint8Array(await newer.async("arraybuffer")));
    const plain = zip.file("collection.anki21") || zip.file("collection.anki2");
    if (plain) return new Uint8Array(await plain.async("arraybuffer"));
    throw new Error("that isn't an Anki package (no collection inside)");
}

const rows = (db, sql) => {
    const out = [];
    const st = db.prepare(sql);
    while (st.step()) out.push(st.get());
    st.free();
    return out;
};

// note type id -> the index of its word field
function wordFields(db) {
    const tables = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r[0]));
    const byType = new Map();
    if (tables.has("fields")) {
        const names = new Map();
        for (const [ntid, ord, name] of rows(db, "SELECT ntid, ord, name FROM fields ORDER BY ntid, ord")) {
            if (!names.has(ntid)) names.set(ntid, []);
            names.get(ntid)[ord] = name;
        }
        for (const [ntid, list] of names) byType.set(String(ntid), wordFieldIndex(list));
    } else {
        const [[models]] = rows(db, "SELECT models FROM col");
        for (const [id, m] of Object.entries(JSON.parse(models || "{}"))) {
            const list = [...(m.flds || [])].sort((a, b) => a.ord - b.ord).map((f) => f.name);
            byType.set(String(id), wordFieldIndex(list));
        }
    }
    return byType;
}

// -> {notes, known, learning, skipped}
export async function readKnownWords(file) {
    const [SQL, bytes] = await Promise.all([getSql(), collectionOf(file)]);
    const db = new SQL.Database(bytes);
    try {
        const field = wordFields(db);
        const intervals = new Map();
        for (const [nid, ivl] of rows(db, "SELECT nid, ivl FROM cards")) {
            if (!intervals.has(nid)) intervals.set(nid, []);
            intervals.get(nid).push(Number(ivl) || 0);
        }
        const words = [];
        for (const [id, mid, flds] of rows(db, "SELECT id, mid, flds FROM notes")) {
            const values = String(flds).split("\x1f");
            const word = cleanWord(values[field.get(String(mid)) ?? 0]);
            if (word) words.push({ word, status: statusOf(intervals.get(id) || []) });
        }
        return words;
    } finally {
        db.close();
    }
}

// The panel's "or from an Anki file": say(text, bad) shows progress and the result
export async function importKnownFromFile(file, say = () => {}) {
    try {
        say(`reading ${file.name}…`);
        const words = await readKnownWords(file);
        let known = 0, learning = 0;
        for (const { word, status } of words) {
            if (setWordStatus(word, status, { save: false, downgrade: false })) status === "known" ? known++ : learning++;
        }
        saveWords();
        say(`imported ${known} known + ${learning} learning words from ${words.length} notes in ${file.name} ✓`);
        return { notes: words.length, known, learning };
    } catch (err) {
        say("import failed: " + err.message, true);
        return null;
    }
}
