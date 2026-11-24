// Reading a saved text: paragraphs with clickable words, furigana, % known, and the
// reading position remembered. Long books are split into words in batches, starting
// where you left off, so the page is usable right away.
//
// Big books stay fast: only the paragraphs near what's on screen are drawn as clickable words
// (an IntersectionObserver swaps them in and out); the rest stay plain text. The % known still
// covers the whole book, and is recalculated at most a few times a second.

import { $ } from "../core/dom.js";
import { store, escapeHtml } from "../core/utils.js";
import { pctLevel, wordStatus } from "../words/status.js";
import { tokenize, tokensHtml, recolor, comprehension, sentenceAround } from "../words/render.js";
import { bindWordDisplay } from "../words/display.js";
import { watchHover } from "../words/hover.js";
import { enableWordClicks } from "../popup.js";
import { readingOf, saveReading } from "./library.js";
import { understood, target } from "../core/target.js";
import { langOf } from "../core/script.js";
import { prime, coverageIfKnown, coverage } from "../core/coverage.js";

const BATCH = 150;             // paragraphs per /api/tokenize request
const SETTINGS = "akko-reader";
const NEAR = "1500px";         // how far beyond the visible part paragraphs get clickable words

const ui = {
    section: $("#reader-section"), text: $("#reader-text"), title: $("#reader-title"),
    stats: $("#reader-stats"), badge: $("#reader-badge"), back: $("#reader-back"), prime: $("#reader-prime"),
    size: $("#reader-size"), vertical: $("#reader-vertical"),
};

let rec = null;                // the open text
let tokens = [];               // tokens per paragraph (undefined until analysed)

// the open text and where we are in it, for the read-aloud button in read.js
export const currentRec = () => rec;
export const currentPosition = () => (rec ? rec.position : 0);
let job = 0;                   // bumps when another text opens, so old batches are dropped
let onClose = () => {};
const near = new Set();        // paragraphs on or near the screen
const drawn = new Set();       // paragraphs currently drawn as clickable words
let observer = null;

export const isOpen = () => rec !== null;

export function openText(text) {
    job++;
    rec = { ...text, position: readingOf(text).position };
    // the language it is written in (a book filed before this was detected still reads right)
    rec.txtLang = langOf((text.paragraphs || []).join("\n"), text.lang || target());
    tokens = new Array(text.paragraphs.length);
    const words = document.getElementById("reader-words");
    if (words) words.hidden = true;               // nor its word list
    if (ui.prime) ui.prime.hidden = true;          // last text's "learn these first" is not this one's
    near.clear();
    drawn.clear();
    ui.title.textContent = text.title;
    ui.text.innerHTML = text.paragraphs.map((p, i) => `<p data-i="${i}">${escapeHtml(p)}</p>`).join("");
    ui.section.hidden = false;
    watchParagraphs();
    renderStats();
    requestAnimationFrame(() => goTo(rec.position));
    tokenizeAll(job);
}

function close() {
    stopReadAloud();
    job++;
    if (observer) observer.disconnect();
    rec = null;
    ui.section.hidden = true;
    ui.text.innerHTML = "";
    onClose();
}

// Scroll the reader (not the page) to paragraph i
function goTo(i) {
    const p = ui.text.children[i];
    if (!p) return;
    const y = window.scrollY;
    p.scrollIntoView({ block: "start", inline: "start", behavior: "instant" });
    window.scrollTo({ top: y, behavior: "instant" });
}

// ---------- drawing only what's near the screen ----------

function draw(i) {
    if (drawn.has(i) || !tokens[i]) return;
    ui.text.children[i].innerHTML = tokensHtml(tokens[i], { offsets: true });
    drawn.add(i);
}

function undraw(i) {
    if (!drawn.has(i)) return;
    ui.text.children[i].textContent = rec.paragraphs[i];
    drawn.delete(i);
}

function watchParagraphs() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
            const i = Number(e.target.dataset.i);
            if (e.isIntersecting) { near.add(i); draw(i); } else { near.delete(i); undraw(i); }
        }
    }, { root: ui.text, rootMargin: NEAR });
    for (const p of ui.text.children) observer.observe(p);
}

// ---------- splitting into words ----------

async function tokenizeAll(myJob) {
    const n = rec.paragraphs.length;
    const first = Math.floor((rec.position || 0) / BATCH) * BATCH;
    const starts = [];
    for (let s = first; s < n; s += BATCH) starts.push(s);
    for (let s = 0; s < first; s += BATCH) starts.push(s);

    for (const s of starts) {
        let batch;
        try { batch = await tokenize(rec.paragraphs.slice(s, s + BATCH), rec.txtLang || target()); } catch { return; }
        if (myJob !== job) return;
        batch.forEach((t, k) => {
            tokens[s + k] = t;
            if (near.has(s + k)) draw(s + k);
        });
        statsSoon();
    }
    statsSoon();
}

// ---------- % known ----------

function renderStats() {
    const done = tokens.filter(Boolean);
    if (!done.length) {
        ui.stats.textContent = "analysing…";
        ui.badge.hidden = true;
        return;
    }
    const c = comprehension(done);
    const analysed = Math.round((done.length / tokens.length) * 100);
    ui.stats.textContent = `${c.unknown} unknown words` + (analysed < 100 ? ` · analysing ${analysed}%` : "");
    ui.badge.hidden = false;
    ui.badge.className = "comp-badge inline " + pctLevel(c.pct);
    ui.badge.innerHTML = `<b>${c.pct}%</b> ${understood()}`;
    ui.badge.title = `you know ${c.known} of the ${c.total} words in this text (ignored words don't count)`;
    // once the whole text is analysed, the library shows its % and the words worth learning come out
    if (done.length === tokens.length) {
        const was = readingOf(rec);
        const patch = {};
        if (c.pct !== was.pct) patch.pct = c.pct;
        // lines one word away, kept for Settings → Stats (and only when it moved: one write)
        if (c.iPlus1 !== was.iPlus1 || c.total !== was.words) Object.assign(patch, { iPlus1: c.iPlus1, words: c.total, paragraphs: done.length });
        if (Object.keys(patch).length) saveReading(rec.id, patch);
        renderPrime(done, c);
        renderBookWords();
    } else if (ui.prime) ui.prime.hidden = true;
}

// What to learn before starting: a handful of words that finish the most lines (scripts/core/coverage.js),
// with what they'd add up to. Nothing is marked here — the words are coloured, so you can click one.
function renderPrime(done, c) {
    if (!ui.prime) return;
    const picks = c.unknown.size ? prime(done, { limit: 6 }) : [];
    if (!picks.length) {
        ui.prime.hidden = true;
        return;
    }
    const after = coverageIfKnown(done, picks.map((p) => p.word));
    ui.prime.hidden = false;
    ui.prime.innerHTML = `<b>learn these first</b> ${picks.map((p) => `<span class="prime-word" title="${p.count} time${p.count > 1 ? "s" : ""} in this text${p.unlocks ? `, and ${p.unlocks} line${p.unlocks > 1 ? "s" : ""} would be fully understood` : ""}">${escapeHtml(p.sample)}</span>`).join(" ")}
        ${after.pct > c.pct ? `<span class="prime-gain">${c.pct}% → <b>${after.pct}%</b></span>` : ""}`;
}

// counting a whole book takes a moment, so it runs at most every half second
let statsTimer = null;
function statsSoon() {
    if (statsTimer) return;
    statsTimer = setTimeout(() => {
        statsTimer = null;
        if (rec) renderStats();
    }, 500);
}

// ---------- reading position ----------

let saveTimer = null;
function trackPosition() {
    if (!rec) return;
    const r = ui.text.getBoundingClientRect();
    const vertical = ui.vertical.checked;
    const hit = document.elementFromPoint(vertical ? r.right - 30 : r.left + r.width / 2, vertical ? r.top + r.height / 2 : r.top + 16);
    const p = hit && hit.closest("#reader-text p[data-i]");
    if (!p) return;
    rec.position = Number(p.dataset.i);
    clearTimeout(saveTimer);
    const { id, position } = rec;
    saveTimer = setTimeout(() => saveReading(id, { position }), 600);
}

// ---------- read aloud ----------
// The browser's own speech synthesis reads the text from where you are, each word lit up as it's
// said. Nothing is sent anywhere. The words met on the way go into this book's word list
// (readWords on its reading record), shown under the text.

let readJob = 0;
let speaking = false;             // a read-aloud run is going (also between two sentences)
let readHighlight = null;
let finishSentence = null;        // resolves the sentence being spoken, so Stop never leaves it hanging
let readMet = null;               // {id, words: Set} of the run going on

// the speech tag for a text's language: voices are listed as ja-JP, zh-CN, zh-HK…
const SPEECH_LANG = { ja: "ja-JP", en: "en-US", ko: "ko-KR", cmn: "zh-CN", zh: "zh-CN", yue: "zh-HK" };
const speechLang = (lang) => SPEECH_LANG[lang] || lang;

// Chrome lists its voices a moment after the page loads
function voices() {
    const now = speechSynthesis.getVoices();
    if (now.length) return Promise.resolve(now);
    return new Promise((resolve) => {
        const done = () => resolve(speechSynthesis.getVoices());
        speechSynthesis.addEventListener("voiceschanged", done, { once: true });
        setTimeout(done, 1500);
    });
}

// A voice for this language; without one the browser reads Japanese with an English voice (or not at all)
async function voiceFor(tag) {
    const norm = (l) => l.toLowerCase().replace("_", "-");
    const want = norm(tag);
    const all = await voices();
    return all.find((v) => norm(v.lang) === want && v.localService)
        || all.find((v) => norm(v.lang) === want)
        || all.find((v) => norm(v.lang).split("-")[0] === want.split("-")[0])
        || null;
}

// Sentences of a paragraph with where each starts: one utterance per sentence, since Chrome cuts
// long utterances off after about 15 seconds
export function sentencesOf(text) {
    const out = [];
    const re = /[^。！？!?.\n]+(?:[。！？!?.]+[」』）)"'’”]*)?|[。！？!?.\n]+/g;
    let m;
    while ((m = re.exec(text))) {
        if (m[0].trim()) out.push({ text: m[0], at: m.index });
    }
    return out.length ? out : [{ text, at: 0 }];
}

function flushMet() {
    const run = readMet;
    readMet = null;
    if (!run || !run.words.size) return;
    const was = readingOf({ id: run.id });
    const existing = was.readWords || [];
    const merged = [...new Set([...existing, ...run.words])];
    if (merged.length !== existing.length) saveReading(run.id, { readWords: merged });
    renderBookWords();
}

export function stopReadAloud() {
    readJob++;
    speaking = false;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    if (finishSentence) finishSentence();
    unhighlightRead();
    flushMet();
}

export const isReadingAloud = () => speaking;

// Keep the word in view inside the reader, without scrolling the page itself
function keepInView(el) {
    const box = ui.text.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right) return;
    const y = window.scrollY, x = window.scrollX;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    window.scrollTo({ top: y, left: x, behavior: "instant" });
}

function highlightRead(el) {
    unhighlightRead();
    readHighlight = el;
    el.classList.add("reading-aloud");
    keepInView(el);
}
function unhighlightRead() {
    if (readHighlight) readHighlight.classList.remove("reading-aloud");
    readHighlight = null;
}

// The word token covering character `at` of paragraph i, if it is a word
function tokenAt(i, at) {
    const tk = tokens[i];
    if (!tk) return null;
    let pos = 0;
    for (const t of tk) {
        const end = pos + t.s.length;
        if (at < end) return t.b ? { t, start: pos } : null;
        pos = end;
    }
    return null;
}

function speak(text, voice, tag, onBoundary) {
    return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = tag;
        if (voice) u.voice = voice;
        u.onboundary = onBoundary;
        const done = () => { finishSentence = null; resolve(); };
        u.onend = done;
        u.onerror = done;
        finishSentence = done;
        speechSynthesis.speak(u);
    });
}

// Read every paragraph from `start` onward. Rejects (before saying anything) when the browser
// can't speak or has no voice for the text's language.
export async function readAloudFrom(start) {
    if (!rec) return;
    if (typeof speechSynthesis === "undefined") throw new Error("this browser can't read aloud");
    stopReadAloud();
    const myJob = ++readJob;
    const tag = speechLang(rec.txtLang || target());
    const voice = await voiceFor(tag);
    if (!voice) throw new Error(`no ${tag} voice is installed: add one in your system's speech settings`);
    if (myJob !== readJob || !rec) return;
    speaking = true;
    readMet = { id: rec.id, words: new Set() };
    const met = readMet.words;

    for (let i = Math.max(0, start || 0); rec && i < rec.paragraphs.length && myJob === readJob; i++) {
        draw(i);               // a paragraph not analysed yet is still read, just without highlighting
        const text = tokens[i] ? tokens[i].map((t) => t.s).join("") : rec.paragraphs[i];
        for (const s of sentencesOf(text)) {
            if (myJob !== readJob) break;
            await speak(s.text, voice, tag, (e) => {
                if (myJob !== readJob || e.name !== "word") return;
                const hit = tokenAt(i, s.at + e.charIndex);
                if (!hit) return;
                if (hit.t.c) met.add(hit.t.b);
                // looked up each time: the paragraph may have been redrawn since
                draw(i);
                const p = ui.text.children[i];
                const span = p && p.querySelector(`.w[data-o="${hit.start}"]`);
                if (span && span !== readHighlight) highlightRead(span);
            });
        }
        unhighlightRead();
    }
    if (myJob === readJob) {
        speaking = false;
        flushMet();
    }
}

// ---------- this book's words ----------
// The words of this text you don't know yet, most frequent first, and how many were met reading
// aloud. Downloadable as a .tsv (word, times in the text, met reading aloud).

function bookWords() {
    const done = tokens.filter(Boolean);
    const unknown = done.length ? [...coverage(done).unknown].sort((a, b) => b[1] - a[1]) : [];
    return { unknown, heard: readingOf(rec).readWords || [], analysing: done.length < tokens.length };
}

function renderBookWords() {
    const box = document.getElementById("reader-words");
    if (!box || !rec) return;
    const { unknown, heard, analysing } = bookWords();
    box.hidden = !unknown.length && !heard.length;
    if (box.hidden) return;
    document.getElementById("reader-words-summary").textContent =
        `${unknown.length} words you don't know yet in this text` + (heard.length ? ` · ${heard.length} met reading aloud` : "")
        + (analysing ? " (still analysing)" : "");
    document.getElementById("reader-words-list").innerHTML = unknown.slice(0, 80).map(([w, n]) =>
        `<li><span class="w s-${wordStatus(w)}" data-b="${escapeHtml(w)}" data-c="1">${escapeHtml(w)}</span> <small>×${n}</small></li>`).join("");
}

function downloadBookWords() {
    if (!rec) return;
    const { unknown, heard } = bookWords();
    const met = new Set(heard);
    const rows = ["word\ttimes in text\tmet reading aloud", ...unknown.map(([w, n]) => `${w}\t${n}\t${met.has(w) ? "yes" : ""}`)];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/tab-separated-values" }));
    a.download = `${(rec.title || "words").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- settings ----------

function applySettings(save = true) {
    ui.text.style.setProperty("--reader-size", ui.size.value + "px");
    ui.text.classList.toggle("vertical", ui.vertical.checked);
    if (save) store.set(SETTINGS, { size: Number(ui.size.value), vertical: ui.vertical.checked });
}

export function init({ onBack }) {
    onClose = onBack;
    const s = { size: 22, vertical: false, ...store.get(SETTINGS, {}) };
    ui.size.value = s.size;
    ui.vertical.checked = s.vertical;
    applySettings(false);
    ui.size.addEventListener("input", () => applySettings());
    ui.vertical.addEventListener("input", () => {
        const at = rec && rec.position;
        applySettings();
        if (rec) requestAnimationFrame(() => goTo(at));
    });
    bindWordDisplay($("#furigana-mode"), $("#color-words"));
    const dl = document.getElementById("reader-words-download");
    if (dl) dl.addEventListener("click", downloadBookWords);
    window.addEventListener("akko-words-changed", () => { if (rec) renderBookWords(); });

    ui.back.addEventListener("click", close);
    ui.text.addEventListener("scroll", trackPosition, { passive: true });

    enableWordClicks(ui.text, "p[data-i]", (p, w) => {
        const text = rec.paragraphs[Number(p.dataset.i)];
        return {
            sentence: w && w.dataset.o !== undefined ? sentenceAround(text, Number(w.dataset.o)) : text,
            info: { source: rec.title, url: rec.url },
        };
    });
    watchHover(ui.text);

    window.addEventListener("akko-words-changed", () => {
        if (!rec) return;
        recolor(ui.text);         // only the drawn paragraphs have words to recolour
        statsSoon();
    });
}
