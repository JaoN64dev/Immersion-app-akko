// Reading a saved text: paragraphs with clickable words, furigana, % known, and the
// reading position remembered. Long books are split into words in batches, starting
// where you left off, so the page is usable right away.
//
// Big books stay fast: only the paragraphs near what's on screen are drawn as clickable words
// (an IntersectionObserver swaps them in and out); the rest stay plain text. The % known still
// covers the whole book, and is recalculated at most a few times a second.

import { $ } from "../core/dom.js";
import { store, escapeHtml } from "../core/utils.js";
import { pctLevel } from "../words/status.js";
import { tokenize, tokensHtml, recolor, comprehension, sentenceAround } from "../words/render.js";
import { bindWordDisplay } from "../words/display.js";
import { watchHover } from "../words/hover.js";
import { enableWordClicks } from "../popup.js";
import { readingOf, saveReading } from "./library.js";
import { understood, target } from "../core/target.js";
import { langOf } from "../core/script.js";
import { prime, coverageIfKnown } from "../core/coverage.js";

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

let readJob = 0;
let readUtterance = null;
let readHighlight = null;

export function stopReadAloud() {
    readJob++;
    if (readUtterance) {
        readUtterance.onend = null;
        readUtterance.onboundary = null;
        readUtterance = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    unhighlightRead();
}

export function isReadingAloud() {
    return !!readUtterance;
}

function highlightRead(el) {
    unhighlightRead();
    readHighlight = el;
    if (el) {
        el.classList.add("reading-aloud");
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
}
function unhighlightRead() {
    if (readHighlight) {
        readHighlight.classList.remove("reading-aloud");
        readHighlight = null;
    }
}

// character range for each word span in a drawn paragraph
function offsetMap(tk, paraEl) {
    const out = [];
    let pos = 0, si = 0;
    const spans = paraEl.querySelectorAll(".w[data-o]");
    for (const t of tk) {
        const start = pos;
        pos += t.s.length;
        if (t.s === "\n" || !t.b) continue;
        const span = spans[si++];
        if (span) out.push({ el: span, start, end: pos });
    }
    return out;
}

function tokenIndexAt(tk, charIndex) {
    let pos = 0;
    for (let i = 0; i < tk.length; i++) {
        const end = pos + tk[i].s.length;
        if (charIndex >= pos && charIndex < end) return i;
        pos = end;
    }
    return -1;
}

// Read every paragraph from `start` onward, speaking each with word-by-word highlighting.
// Nothing is sent anywhere: the browser's own speech synthesis does the talking.
export async function readAloudFrom(start) {
    stopReadAloud();
    readJob++;
    const myJob = readJob;
    const n = rec.paragraphs.length;
    const met = new Set();

    for (let i = start; i < n && readJob === myJob; i++) {
        const tk = tokens[i];
        if (!tk || !tk.length) continue;   // not tokenized yet
        draw(i);
        const paraEl = ui.text.children[i];
        const map = offsetMap(tk, paraEl);
        if (!map.length) continue;          // no highlightable words

        const text = tk.map((t) => t.s).join("");
        await new Promise((resolve) => {
            if (readJob !== myJob) { resolve(); return; }
            if (typeof speechSynthesis === "undefined") { resolve(); return; }

            const u = new SpeechSynthesisUtterance(text);
            u.lang = (rec.txtLang || target()).slice(0, 2).toLowerCase() === "ja" ? "ja-JP" : (rec.txtLang || "en");
            u.rate = 1;

            let current = -1;
            u.onboundary = (event) => {
                if (readJob !== myJob) return;
                if (event.name !== "word" && event.name !== "white-space") return;
                let found = -1;
                for (let m = 0; m < map.length; m++) {
                    if (event.charIndex >= map[m].start && event.charIndex < map[m].end) { found = m; break; }
                }
                if (found !== -1 && found !== current) {
                    current = found;
                    highlightRead(map[found].el);
                    const ti = tokenIndexAt(tk, map[found].start);
                    const t = tk[ti];
                    if (t && t.b) met.add(t.b);
                }
            };
            u.onend = () => { readUtterance = null; resolve(); };
            u.onerror = () => { readUtterance = null; resolve(); };

            readUtterance = u;
            speechSynthesis.speak(u);
        });
        unhighlightRead();
    }

    // per-book word list: words met during read-aloud are saved with the text's reading record
    if (met.size && rec) {
        const was = readingOf(rec);
        const existing = was.readWords || [];
        const merged = [...new Set([...existing, ...met])];
        if (merged.length !== existing.length) saveReading(rec.id, { readWords: merged });
    }

    readJob++;
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
