// Talking to Anki (AnkiConnect, proxied through /api/anki). Works on every page; the
// settings panel (anki/panel.js) only exists on the Watch page. Settings live in "akko-anki".
//
// media (optional, when sending) = { player: <video>/<audio> to seek, audioFrom: element to
// record the line from, screenshot: bool } — together with item.cueStart/cueEnd. Or, for a
// still source with no timeline (a manga page): { player: <img>, screenshot: true, static: true }.

import { state } from "../core/state.js";
import { store, escapeHtml, getJson, postJson } from "../core/utils.js";
import { toast } from "../core/toast.js";
import { setWordStatus, saveWords } from "../words/status.js";
import { saveItem } from "../mining.js";
import { pitchCardHtml, pitchNotes } from "../words/pitch.js";

const KEY = "akko-anki";
const DEFAULTS = { deck: "", model: "", maps: {}, tags: "akko immersion", auto: false, audio: true, wordAudio: true, shot: true };

// what the site can put into an Anki field
export const SOURCES = {
    "": "(leave empty)",
    word: "word",
    reading: "reading",
    furigana: "word[reading] (furigana)",
    meaning: "meaning",
    pitch: "pitch accent (drawn)",
    pitchNotes: "pitch accent pattern (text)",
    sentence: "sentence",
    sentenceBold: "sentence, word in bold",
    translation: "sentence translation (2nd subs)",
    audio: "line audio",
    wordAudio: "word audio",
    screenshot: "screenshot",
    source: "show, episode, time",
};

// first match wins; covers Basic, Lapis, Kaishi, JP Mining Note, Animecards…
const GUESSES = [
    [/^is[A-Z]|^is /, ""],                                   // Lapis card-type flags
    [/sentence.?(eng|translation|meaning)/i, "translation"],
    [/sentence.?furigana/i, ""],
    [/(word|expression|vocab|term|reading).?audio/i, "wordAudio"],
    [/pitch.*(notes|pattern)/i, "pitchNotes"],
    [/pitch|accent/i, "pitch"],
    [/sentence.?audio|^audio$/i, "audio"],
    [/audio/i, ""],
    [/picture|image|screenshot|photo/i, "screenshot"],
    [/^(sentence|context|example)$|sentence$/i, "sentenceBold"],
    [/furigana/i, "furigana"],
    [/reading|kana/i, "reading"],
    [/meaning|definition|glossary|english|back/i, "meaning"],
    [/word|expression|vocab|front|kanji|term|key/i, "word"],
    [/source|notes|misc/i, "source"],
];
// sources added after people had already set up their fields
const LATER_SOURCES = ["wordAudio", "pitch", "pitchNotes", "translation"];
const guess = (field) => (GUESSES.find(([re]) => re.test(field)) || [null, ""])[1];

// always read fresh: another page may have changed it
export const cfg = () => ({ ...DEFAULTS, ...store.get(KEY, {}) });
export const saveCfg = (patch) => store.set(KEY, { ...cfg(), ...patch });
export const auto = () => cfg().auto;

let connected = false;
let fieldNames = [];
const listeners = [];

// messages go to the panel (if any) and a toast
export const onMessage = (fn) => listeners.push(fn);
function say(text, bad = false, { quiet = false } = {}) {
    listeners.forEach((fn) => fn(text, bad));
    if (!quiet) toast(text, bad);
}

export async function call(action, params = {}) {
    const r = await postJson("/api/anki", { action, version: 6, params });
    if (r.error) throw new Error(r.error);
    return r.result;
}

// ---------- connecting + field mapping ----------

// Returns {decks, models}; throws if Anki can't be reached
export async function connect() {
    try {
        await call("version");
        const [decks, models] = await Promise.all([call("deckNames"), call("modelNames")]);
        const c = cfg();
        saveCfg({
            deck: decks.includes(c.deck) ? c.deck : decks[0] || "",
            model: models.includes(c.model) ? c.model : models[0] || "",
        });
        await loadFields();
        connected = true;
        return { decks, models };
    } catch (err) {
        connected = false;
        throw err;
    }
}

export const isConnected = () => connected;

async function ensureConnected() {
    if (connected) return true;
    try { await connect(); return true; } catch (err) {
        say("can't reach Anki. open Anki (with AnkiConnect) and try again.", true);
        return false;
    }
}

// Field names of the chosen note type + how each is filled (guessed the first time)
export async function loadFields() {
    const c = cfg();
    fieldNames = await call("modelFieldNames", { modelName: c.model });
    if (!c.maps[c.model]) {
        saveCfg({ maps: { ...c.maps, [c.model]: Object.fromEntries(fieldNames.map((f) => [f, guess(f)])) } });
    } else {
        // maps saved before these sources existed left their fields empty (or, for
        // "Pitch Accent Notes", on "source"); fill them in once
        const todo = LATER_SOURCES.filter((s) => !(c.filled || (c.wordAudioMapped ? ["wordAudio"] : [])).includes(s));
        if (todo.length) {
            const fill = (f, src) => {
                const g = guess(f);
                return todo.includes(g) && (!src || (g === "pitchNotes" && src === "source")) ? g : src;
            };
            const maps = Object.fromEntries(Object.entries(c.maps).map(([model, map]) => [model,
                Object.fromEntries(Object.entries(map).map(([f, src]) => [f, fill(f, src)]))]));
            saveCfg({ maps, filled: LATER_SOURCES });
        }
    }
    return { fieldNames, map: cfg().maps[c.model] };
}

export function setFieldSource(field, source) {
    const c = cfg();
    saveCfg({ maps: { ...c.maps, [c.model]: { ...c.maps[c.model], [field]: source } } });
}

// ---------- media capture ----------

const seekTo = (v, t) => new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.01) return resolve();
    v.addEventListener("seeked", resolve, { once: true });
    v.currentTime = t;
});

const blobToBase64 = (blob) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.readAsDataURL(blob);
});

// Works on a <video> (videoWidth/videoHeight) or a still <img> (naturalWidth/naturalHeight),
// e.g. a manga page.
function grabFrame(el) {
    const srcW = el.videoWidth || el.naturalWidth;
    const srcH = el.videoHeight || el.naturalHeight;
    const w = Math.min(el.videoWidth ? 640 : 1000, srcW);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = Math.round(srcH * (w / srcW));
    canvas.getContext("2d").drawImage(el, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];   // throws on a cross-origin source
}

// Plays the line once and records its audio
async function recordClip(player, from, start, end) {
    const capture = from.captureStream || from.mozCaptureStream;
    if (!capture || typeof MediaRecorder === "undefined") throw new Error("this browser can't record audio");
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));

    await seekTo(player, Math.max(0, start - 0.15));
    await player.play();
    const stream = capture.call(from);
    if (!stream.getAudioTracks().length) {
        await new Promise((resolve) => {
            stream.addEventListener("addtrack", resolve, { once: true });
            setTimeout(resolve, 1000);
        });
    }
    const tracks = stream.getAudioTracks();
    if (!tracks.length) throw new Error("no audio track to record");

    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start();

    const deadline = performance.now() + (end - start + 3) * 1000;
    await new Promise((resolve) => {
        const check = () => (player.currentTime >= end + 0.2 || player.paused || player.ended || performance.now() > deadline)
            ? resolve() : setTimeout(check, 30);
        check();
    });
    player.pause();
    rec.stop();
    await stopped;
    return { data: await blobToBase64(new Blob(chunks, { type: mime })), ext: mime.includes("ogg") ? "ogg" : "webm" };
}

async function captureMedia(item, media, wantShot, wantAudio) {
    const out = { problems: [] };
    if (!media || (!media.static && item.cueStart === null) || (!wantShot && !wantAudio)) return out;
    const { player } = media;

    state.recording = true;
    const back = media.static ? null : player.currentTime;
    try {
        if (wantShot && media.screenshot) {
            try {
                if (!media.static) await seekTo(player, (item.cueStart + item.cueEnd) / 2);
                out.screenshot = grabFrame(player);
            } catch { out.problems.push("screenshot blocked by the video host"); }
        }
        if (wantAudio && !media.static) {
            say("recording the line's audio…", false, { quiet: true });
            try { out.audio = await recordClip(player, media.audioFrom || player, item.cueStart, item.cueEnd); }
            catch (err) { out.problems.push("audio: " + err.message); }
        }
    } finally {
        if (!media.static) {
            player.pause();
            await seekTo(player, back);
        }
        state.recording = false;
    }
    return out;
}

// Pronunciation of the word itself, found by the server (JapanesePod101, then Lingua Libre;
// for English, dictionaryapi.dev)
const fetchWordAudio = (item) => {
    const params = new URLSearchParams({ word: item.word, reading: item.reading || "", lang: item.lang || "ja" });
    (item.forms || []).forEach((f) => params.append("form", f));
    return getJson(`/api/audio?${params}`);
};

// ---------- building the note ----------

function fieldValue(source, item) {
    const bold = item.surface && item.sentence.includes(item.surface)
        ? escapeHtml(item.sentence).replace(escapeHtml(item.surface), `<b>${escapeHtml(item.surface)}</b>`)
        : escapeHtml(item.sentence);
    switch (source) {
        case "word": return escapeHtml(item.word);
        case "reading": return escapeHtml(item.reading);
        case "furigana": return item.reading && item.reading !== item.word
            ? `${escapeHtml(item.word)}[${escapeHtml(item.reading)}]` : escapeHtml(item.word);
        case "meaning": return escapeHtml(item.meaning);
        case "pitch": return (item.pitch || []).map((n) => pitchCardHtml(item.reading || item.word, n)).join("・");
        case "pitchNotes": return (item.pitch || []).map((n) => escapeHtml(pitchNotes(item.reading || item.word, n))).join("<br>");
        case "sentence": return escapeHtml(item.sentence);
        case "translation": return escapeHtml(item.translation || "");
        case "sentenceBold": return bold;
        case "source": return escapeHtml(`${item.source} ${item.time}`.trim());
        default: return "";
    }
}

// Add a mined item as a note. Resolves to whether it worked.
export async function send(item, media) {
    if (!item || !(await ensureConnected())) return false;
    const c = cfg();
    const map = c.maps[c.model] || {};
    const fieldsFor = (src) => fieldNames.filter((f) => map[f] === src);
    const fields = Object.fromEntries(fieldNames.map((f) => [f, fieldValue(map[f], item)]));

    say(`adding ${item.word}…`, false, { quiet: true });
    // download the word's audio while the line is being recorded
    const wordAudioP = c.wordAudio && fieldsFor("wordAudio").length > 0
        ? fetchWordAudio(item).catch((err) => ({ error: err.message }))
        : null;
    const result = await captureMedia(item, media,
        c.shot && fieldsFor("screenshot").length > 0,
        c.audio && fieldsFor("audio").length > 0);
    const stamp = `akko_${item.added}`;
    const wordAudio = await wordAudioP;
    if (wordAudio?.error) result.problems.push(wordAudio.error);

    const note = {
        deckName: c.deck,
        modelName: c.model,
        fields,
        tags: c.tags.split(/\s+/).filter(Boolean),
        options: { allowDuplicate: false, duplicateScope: "deck" },
    };
    if (result.screenshot) note.picture = [{ data: result.screenshot, filename: `${stamp}.jpg`, fields: fieldsFor("screenshot") }];
    note.audio = [];
    if (result.audio) note.audio.push({ data: result.audio.data, filename: `${stamp}.${result.audio.ext}`, fields: fieldsFor("audio") });
    if (wordAudio?.data) note.audio.push({ data: wordAudio.data, filename: `${stamp}_word.${wordAudio.ext}`, fields: fieldsFor("wordAudio") });

    try {
        item.ankiNoteId = await call("addNote", { note });
        saveItem(item).catch(() => {});      // a failed save is already warned about
        say(`added ${item.word} to ${c.deck} ✓` + (result.problems.length ? ` (${result.problems.join(", ")})` : ""));
        return true;
    } catch (err) {
        say(`${item.word}: ${err.message}`, true);
        return false;
    }
}

// ---------- importing known words ----------

// "<b>食べる</b>[たべる]" / "食べる, 喰べる" -> "食べる"
const cleanWord = (html) => String(html || "")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\[[^\]]*\]/g, "")
    .trim().split(/[\s,、・;/]+/)[0];

// Mature cards (interval ≥ 21 days) -> known, the rest -> learning
export async function importKnown() {
    if (!(await ensureConnected())) return;
    const c = cfg();
    try {
        say(`reading ${c.deck}…`, false, { quiet: true });
        const cards = await call("findCards", { query: `deck:"${c.deck.replace(/"/g, '\\"')}"` });
        const map = c.maps[c.model] || {};
        const wordField = Object.keys(map).find((f) => map[f] === "word") || Object.keys(map).find((f) => map[f] === "furigana");
        let known = 0, learning = 0;
        for (let i = 0; i < cards.length; i += 500) {
            say(`reading cards ${i + 1}–${Math.min(i + 500, cards.length)} of ${cards.length}…`, false, { quiet: true });
            for (const card of await call("cardsInfo", { cards: cards.slice(i, i + 500) })) {
                // the mapped "word" field for our note type, otherwise the note's first field
                const field = card.modelName === c.model && wordField && card.fields[wordField]
                    ? card.fields[wordField]
                    : Object.values(card.fields).sort((a, b) => a.order - b.order)[0];
                const w = cleanWord(field && field.value);
                if (!w) continue;
                const status = card.interval >= 21 ? "known" : "learning";
                if (setWordStatus(w, status, { save: false, downgrade: false })) status === "known" ? known++ : learning++;
            }
        }
        saveWords();
        say(`imported ${known} known + ${learning} learning words from ${cards.length} cards ✓`);
    } catch (err) {
        say("import failed: " + err.message, true);
    }
}
