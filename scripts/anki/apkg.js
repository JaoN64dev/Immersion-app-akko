// Anki without AnkiConnect (3.0, feature 12): the mined words as an .apkg deck file you open in
// Anki (File → Import, or double-click it). Everything happens in the browser: sql.js writes Anki's
// collection (SQLite), JSZip packs it with the media.
//
// - fields: word, reading, meaning, the sentence (word in bold), its translation, pitch accent,
//   frequency, the source and its URL, plus the media akko kept: the scene's picture, the line's
//   audio (scripts/core/media.js) and the word said by a speaker (/api/audio, when there is one)
// - a word already reviewed in 復習 arrives with its schedule (interval and next review), so it
//   doesn't start over as new; the others arrive as new cards
// - each note's id comes from the mined word, so importing a newer export updates the notes
//   instead of doubling them
// The note type ("akko") and the deck ("akko::Japanese" …) have fixed ids for the same reason.

import { loadScript } from "../core/utils.js";
import { getJSZip } from "../reader/import.js";
import { mediaOf } from "../core/media.js";
import { profile } from "../core/target.js";
import { fieldValue, fetchWordAudio } from "./client.js";
import { scheduleOf } from "./schedule.js";

const SQLJS = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/";
const MODEL_ID = 1732400000001;                    // the "akko" note type, the same in every export

// the deck's id: fixed per language, so every export lands in the same deck
const deckId = (lang) => 1732400000100 + [...lang].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 99991, 7);

export const FIELDS = ["Word", "Reading", "Meaning", "Sentence", "Translation", "Picture", "SentenceAudio",
    "WordAudio", "Pitch", "Frequency", "FreqSort", "Source", "URL"];

const CSS = `.card { font-family: "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif; font-size: 22px; text-align: center; color: black; background: white; }
.word { font-size: 44px; margin: .3em 0; }
.sentence { font-size: 24px; margin: .6em 0; }
.sentence b { color: #d33; }
.reading { font-size: 26px; }
.meaning { margin: .5em auto; max-width: 36em; }
.translation, .source, .freq { color: #777; font-size: 16px; margin: .4em 0; }
img { max-width: 100%; max-height: 50vh; margin-top: .5em; }
.nightMode .card, .night_mode .card { color: #eee; background: #222; }`;

const FRONT = `<div class="word">{{Word}}</div>
{{#Sentence}}<div class="sentence">{{Sentence}}</div>{{/Sentence}}`;
const BACK = `{{FrontSide}}
<hr id="answer">
<div class="reading">{{Reading}}</div>
{{#Pitch}}<div>{{Pitch}}</div>{{/Pitch}}
<div class="meaning">{{Meaning}}</div>
{{#Translation}}<div class="translation">{{Translation}}</div>{{/Translation}}
{{SentenceAudio}} {{WordAudio}}
{{#Picture}}<div>{{Picture}}</div>{{/Picture}}
{{#Frequency}}<div class="freq">{{Frequency}}</div>{{/Frequency}}
{{#Source}}<div class="source">{{#URL}}<a href="{{URL}}">{{/URL}}{{Source}}{{#URL}}</a>{{/URL}}</div>{{/Source}}`;

const EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a", "image/jpeg": "jpg", "image/png": "png" };

async function getSql() {
    await loadScript(`${SQLJS}sql-wasm.js`);
    return window.initSqlJs({ locateFile: (f) => SQLJS + f });
}

// Anki's duplicate check: the first 8 hex digits of the sha1 of the first field, as a number
async function checksum(text) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
    return parseInt([...hash.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(""), 16);
}

const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// items: the mined words (newest first is fine); cards: 復習's {lemma: card}; onProgress(text)
export async function exportApkg(items, { cards = {}, lang = "ja", onProgress = () => {}, wordAudio = true } = {}) {
    if (!items.length) throw new Error("nothing mined yet");
    const [SQL, JSZip] = await Promise.all([getSql(), getJSZip()]);
    const now = Date.now();
    const nowS = Math.floor(now / 1000);
    const crt = Math.floor(new Date(new Date(now).toDateString()).getTime() / 1000) - 365 * 86400;   // a year back: room for old due dates
    const did = deckId(lang);
    const deckName = `akko::${profile(lang).english}`;

    const zip = new JSZip();
    const mediaMap = {};
    let mediaN = 0;
    const addMedia = (name, bytes) => { zip.file(String(mediaN), bytes); mediaMap[String(mediaN)] = name; mediaN++; return name; };

    const db = new SQL.Database();
    db.run(`
        CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
        CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
        CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
        CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
        CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
        CREATE INDEX ix_notes_usn on notes (usn);
        CREATE INDEX ix_cards_usn on cards (usn);
        CREATE INDEX ix_revlog_usn on revlog (usn);
        CREATE INDEX ix_cards_nid on cards (nid);
        CREATE INDEX ix_cards_sched on cards (did, queue, due);
        CREATE INDEX ix_revlog_cid on revlog (cid);
        CREATE INDEX ix_notes_csum on notes (csum);`);

    const model = {
        id: MODEL_ID, name: "akko", type: 0, mod: nowS, usn: -1, sortf: 0, did, tags: [], vers: [],
        flds: FIELDS.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
        tmpls: [{ name: "word", ord: 0, qfmt: FRONT, afmt: BACK, did: null, bqfmt: "", bafmt: "" }],
        css: CSS, req: [[0, "any", [0]]],
        latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        latexPost: "\\end{document}",
    };
    const deck = (id, name) => ({
        id, name, mod: nowS, usn: -1, desc: "", dyn: 0, conf: 1, collapsed: false,
        newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0], extendNew: 10, extendRev: 50,
    });
    const dconf = {
        1: {
            id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
            new: { delays: [1, 10], ints: [1, 4, 0], initialFactor: 2500, order: 1, perDay: 20, bury: false },
            rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, bury: false, minSpace: 1 },
            lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 },
        },
    };
    const conf = { nextPos: items.length + 1, estTimes: true, activeDecks: [1], sortType: "noteFld", timeLim: 0, sortBackwards: false, addToCur: true, curDeck: did, newSpread: 0, dueCounts: true, curModel: MODEL_ID, collapseTime: 1200 };
    db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", [
        crt, now, now, JSON.stringify(conf), JSON.stringify({ [MODEL_ID]: model }),
        JSON.stringify({ 1: deck(1, "Default"), [did]: deck(did, deckName) }), JSON.stringify(dconf),
    ]);

    // oldest first, so new cards come up in the order they were mined
    const ordered = [...items].sort((a, b) => (a.added || 0) - (b.added || 0));
    const usedIds = new Set();
    const uniqueId = (want) => { let id = want; while (usedIds.has(id)) id++; usedIds.add(id); return id; };
    let pos = 0;
    let withMedia = 0;
    let scheduled = 0;

    for (const item of ordered) {
        pos++;
        onProgress(`packing ${pos} / ${ordered.length}…`);
        const stamp = `akko_${item.added || pos}`;
        const v = (src) => fieldValue(src, item) || "";
        const f = {
            Word: v("word"), Reading: v("reading"), Meaning: v("meaning"), Sentence: v("sentenceBold"),
            Translation: v("translation"), Picture: "", SentenceAudio: "", WordAudio: "",
            Pitch: v("pitch"), Frequency: v("frequency"), FreqSort: v("freqSort"),
            Source: v("source"), URL: v("url"),
        };
        const kept = item.id ? await mediaOf(item.id) : null;
        if (kept && kept.picture) {
            const name = `${stamp}.${EXT[kept.picture.type] || "jpg"}`;
            f.Picture = `<img src="${addMedia(name, new Uint8Array(await kept.picture.arrayBuffer()))}">`;
        }
        if (kept && kept.audio) {
            const name = `${stamp}.${EXT[kept.audio.type] || "webm"}`;
            f.SentenceAudio = `[sound:${addMedia(name, new Uint8Array(await kept.audio.arrayBuffer()))}]`;
        }
        if (wordAudio) {
            try {
                const a = await fetchWordAudio(item);
                if (a && a.data) f.WordAudio = `[sound:${addMedia(`${stamp}_word.${a.ext || "mp3"}`, b64ToBytes(a.data))}]`;
            } catch { /* no recording of this word, or offline */ }
        }
        if (f.Picture || f.SentenceAudio || f.WordAudio) withMedia++;

        const flds = FIELDS.map((name) => f[name]).join("\x1f");
        const sfld = stripHtml(f.Word);
        const nid = uniqueId(item.added || now);
        const guid = `akko-${item.id || item.added}`;
        db.run("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')",
            [nid, guid, MODEL_ID, nowS, " akko ", flds, sfld, await checksum(sfld)]);

        const s = scheduleOf(cards[item.word], crt);
        if (s) scheduled++;
        db.run("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '')", [
            uniqueId(nid + 1), nid, did, nowS,
            s ? s.type : 0, s ? s.queue : 0, s ? s.due : pos, s ? s.ivl : 0, s ? s.factor : 0, s ? s.reps : 0, s ? s.lapses : 0,
        ]);
    }

    onProgress("zipping…");
    zip.file("collection.anki2", db.export());
    db.close();
    zip.file("media", JSON.stringify(mediaMap));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    return { blob, notes: ordered.length, withMedia, scheduled, deckName };
}
