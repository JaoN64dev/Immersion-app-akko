// The dictionary popup: click a word (or drag-select text) to look it up. Works on every page.
//
// A page calls enableWordClicks(container, lineSelector, contextFor) for each area with words,
// and may call setPopupHooks({onOpen, onClose, media}) to pause/resume its player and
// provide audio/screenshot for Anki.

import { $ } from "./core/dom.js";
import { store, escapeHtml, getJson } from "./core/utils.js";
import { STATUSES, wordStatus, setWordStatus } from "./words/status.js";
import { plainText, expressionText, noteExpression } from "./words/render.js";
import { morae, pattern, isHigh } from "./words/pitch.js";
import * as mining from "./mining.js";
import * as anki from "./anki/client.js";
import { lessonMap } from "./grammar/lessons.js";
import { target, nativeLang, NATIVE_LANGUAGES, learningEnglish } from "./core/target.js";
import { saySentence, sayWord } from "./core/say.js";
import { toast } from "./core/toast.js";

const popup = $("#popup");
let ctx = null;   // { word, lemma, sentence, info, grammar, expression, resume } for the open popup

const hooks = {
    onOpen: () => null,          // returns something handed back to onClose (e.g. "was playing")
    onClose: () => {},
    media: () => null,           // (info) -> media for Anki (see anki/client.js)
};
export const setPopupHooks = (h) => Object.assign(hooks, h);

export const isOpen = () => !popup.hidden;

// word = what was clicked (食べられなかった), lemma = its dictionary form (食べる) if known,
// info = what it came from ({source, time, videoName, cueStart, cueEnd}) for mined cards,
// grammar = ids of the grammar lessons the word is part of,
// expression = the idiom or set phrase it's part of: {key, kind, text (as written here)}
async function lookup(word, { sentence = "", anchor, lemma, info = {}, grammar = [], expression = null }) {
    const resume = hooks.onOpen();
    ctx = { word, lemma, sentence, info, grammar, expression, resume };

    // in full screen only the full-screen element is visible, so the popup has to live inside it
    const host = document.fullscreenElement || home;
    if (popup.parentElement !== host) host.appendChild(popup);
    place(anchor);
    popup.hidden = false;
    popup.innerHTML = `<div class="popup-head"><b lang="${target()}">${escapeHtml(word)}</b><button class="close" title="close">✕</button></div><p class="muted">${target() === "en" ? "looking up…" : "辞書を引いています…"}</p>`;

    try {
        const qs = new URLSearchParams();
        [...new Set([lemma, word].filter(Boolean))].forEach((q) => qs.append("q", q));
        qs.set("form", word);                    // so the server can explain the conjugation
        qs.set("lang", target());
        qs.set("native", nativeLang());          // English words: translations into your language
        // the expression the word is part of, looked up at the same time
        const exQuery = expression && new URLSearchParams({ q: expression.key, lang: target(), native: nativeLang() });
        const [result, lessons, ex] = await Promise.all([getJson("/api/dict?" + qs), grammar.length ? lessonMap() : null,
            exQuery ? getJson("/api/dict?" + exQuery).catch(() => null) : null]);
        if (!ctx || ctx.word !== word) return;   // another lookup started
        if (!ctx.lemma) ctx.lemma = result.query;
        const exEntry = ex && ex.entries && ex.entries[0];
        render(word, { ...result, grammar: grammar.map((id) => lessons.get(id)).filter(Boolean), expression: exEntry ? { ...expression, entry: exEntry } : null });
    } catch (err) {
        popup.querySelector("p").textContent = "lookup failed: " + err.message;
    }
}

// ---------- word status buttons ----------

// key: these buttons are for an expression (its own status), not the clicked word
function statusButtons(lemma, key = "") {
    const cur = wordStatus(lemma);
    return `<div class="status-buttons"${key ? ` data-key="${escapeHtml(key)}"` : ""} title="how well you know ${escapeHtml(lemma)}${key ? "" : " (keys 1 2 3 4)"}. ignored words never count as unknown">`
        + STATUSES.map(([s, label], i) =>
            `<button class="st st-${s}${s === cur ? " on" : ""}" data-status="${s}">${key ? "" : `${i + 1} `}${label}</button>`).join("")
        + `</div>`;
}

export function setPopupStatus(status) {
    if (!ctx || !ctx.lemma) return;
    setWordStatus(ctx.lemma, status);
    const box = popup.querySelector(".status-buttons:not([data-key])");
    if (box) box.outerHTML = statusButtons(ctx.lemma);
}

function setExpressionStatus(key, status) {
    setWordStatus(key, status);
    noteExpression(key);
    const box = popup.querySelector(`.status-buttons[data-key="${CSS.escape(key)}"]`);
    if (box) box.outerHTML = statusButtons(key, key);
}

// ---------- expressions ----------

// The idiom or set phrase the clicked word is part of, above the word's own entry: its meaning
// is usually not its words' (膝が笑う: knees giving way, not "knee" + "laugh")
function expressionHtml(ex) {
    if (!ex) return "";
    const e = ex.entry;
    const en = target() === "en";
    const label = ex.kind === "i" ? (en ? "idiom" : "慣用句 idiom") : (en ? "phrase" : "表現 phrase");
    const senses = en
        ? [...(e.tr || []).slice(0, 2).map((t) => t.words.join(", ")), ...e.senses.slice(0, 3).map((x) => x.gloss.join("; "))].filter(Boolean)
        : e.senses.slice(0, 3).map((x) => x.gloss.join("; "));
    return `<div class="expr-box">
        <span class="expr-label">${label} · ${en ? "part of" : "この単語を含む"}</span>
        <div class="entry"><div class="entry-head">
            <span class="headword" lang="${target()}">${escapeHtml(e.word)}</span>
            ${en ? (e.reading ? `<span class="reading ipa">${escapeHtml(e.reading)}</span>` : "") : readingHtml(e)}
            <button class="mine expr-mine">+ mine</button>
        </div>
        <ol translate="no">${senses.map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ol></div>
        ${statusButtons(ex.key, ex.key)}
    </div>`;
}

// ---------- pitch accent ----------

// Draw a reading with a line over the high morae and a tick where the pitch drops
function pitchHtml(reading, n) {
    const m = morae(reading);
    return `<span class="pitch" title="[${n}] ${pattern(n, m.length)}">`
        + m.map((mora, i) => `<span class="${[isHigh(n, i) && "h", n > 0 && i === n - 1 && "drop"].filter(Boolean).join(" ")}">${escapeHtml(mora)}</span>`).join("")
        + `<sup>${n}</sup></span>`;
}

function readingHtml(e) {
    const p = (e.pitch || []).find((x) => x.reading === e.reading);
    if (p) return `<span class="reading" lang="ja">${p.accents.map((n) => pitchHtml(e.reading, n)).join(" ")}</span>`;
    return e.reading && e.reading !== e.word ? `<span class="reading" lang="ja">${escapeHtml(e.reading)}</span>` : "";
}

// ---------- conjugation + kanji ----------

function inflectionHtml(lemma, labels) {
    if (!labels || !labels.length) return "";
    return `<div class="inflection" title="how the word you clicked is conjugated">
        <span lang="ja">${escapeHtml(lemma)}</span> +
        ${labels.map((l) => `<span class="chip-sm">${escapeHtml(l)}</span>`).join("")}
    </div>`;
}

const KANJI_OPEN = "akko-kanji-open";

function kanjiHtml(list) {
    if (!list || !list.length) return "";
    const open = store.get(KANJI_OPEN, false);
    return `<details class="kanji-box"${open ? " open" : ""}>
        <summary>漢字 <small>${list.map((k) => escapeHtml(k.char)).join(" ")}</small></summary>
        <ul class="kanji-list" translate="no">${list.map((k) => `
            <li>
                <span class="kanji-char" lang="ja">${escapeHtml(k.char)}</span>
                <div>
                    <b>${escapeHtml(k.meanings.join(", "))}</b>
                    ${k.on.length ? `<span lang="ja"><small>音</small> ${escapeHtml(k.on.join("、"))}</span>` : ""}
                    ${k.kun.length ? `<span lang="ja"><small>訓</small> ${escapeHtml(k.kun.join("、"))}</span>` : ""}
                    <span class="kanji-meta">${[k.jlpt, k.strokes && `${k.strokes} strokes`, k.grade && (k.grade <= 6 ? `grade ${k.grade}` : "secondary school")].filter(Boolean).join(" · ")}</span>
                </div>
            </li>`).join("")}
        </ul>
    </details>`;
}

// ---------- the dictionaries you added (Settings → Dictionaries) ----------

// rank badges from the frequency lists (e.freq: [{title, value}]): "JPDB 1234"; lower = more common
function freqHtml(e) {
    return (e.freq || []).map((f) => `<span class="tag freq" title="${escapeHtml(f.title)}: how common the word is (lower = more common)">${escapeHtml(f.title.split(/[\s_[(]/)[0].slice(0, 12))} ${escapeHtml(f.value)}</span>`).join("");
}

// an added dictionary's entry, ready for mining: its meanings as plain text
function minable(e) {
    const box = document.createElement("div");
    box.innerHTML = e.html.join(" ");
    box.querySelectorAll(".yd-extra-info, .yd-attribution, .yd-tag").forEach((x) => x.remove());   // examples, credits, labels
    const items = [...box.querySelectorAll(".yd-glossary li")].map((li) => li.textContent.trim()).filter(Boolean);
    const text = (items.length ? items.join("; ") : box.textContent).replace(/\s+/g, " ").trim().slice(0, 300);
    return { word: e.word, reading: e.reading || e.word, forms: [], pitch: [], senses: [{ gloss: [text], pos: [], misc: [] }] };
}

const MORE_CLOSED = "akko-dict-closed";      // titles of the ones you folded away

// e.html is already made safe by the server (server/dictionaries.js: plain formatting tags only)
function moreHtml(more) {
    if (!more || !more.length) return "";
    const closed = store.get(MORE_CLOSED, []);
    const lang = target();
    return more.map((d, di) => `<details class="more-dict"${closed.includes(d.title) ? "" : " open"} data-title="${escapeHtml(d.title)}">
        <summary translate="no">${escapeHtml(d.title)}</summary>
        ${d.entries.map((e, ei) => `<div class="more-entry">
            <div class="entry-head">
                <span class="headword" lang="${lang}">${escapeHtml(e.word)}</span>
                ${e.reading ? `<span class="reading" lang="${lang}">${escapeHtml(e.reading)}</span>` : ""}
                ${e.tags.slice(0, 6).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
                <button class="mine more-mine" data-d="${di}" data-e="${ei}" title="mine it with this dictionary's meaning">+ mine</button>
            </div>
            <ol class="more-gloss" translate="no" lang="${lang}">${e.html.map((h) => `<li>${h}</li>`).join("")}</ol>
        </div>`).join("")}
    </details>`).join("");
}

// ---------- grammar ----------

// the grammar lessons this word is part of, linking to the lesson (new tab: the video keeps its place)
function grammarHtml(list) {
    if (!list.length) return "";
    return `<div class="grammar-box"><span class="grammar-box-label">${target() === "en" ? "grammar" : "文法 grammar"}</span>${list.map((l) => `
        <a href="/grammar.html#${encodeURIComponent(l.id)}" target="_blank" rel="noopener" title="open the lesson">
            <b lang="${target()}">${escapeHtml(l.title)}</b>${l.meaning ? ` <small>${escapeHtml(l.meaning)}</small>` : ""}
        </a>`).join("")}</div>`;
}

// ---------- English entries ----------

// An English word: American IPA + recording, translations into your language (Settings),
// then English definitions
function englishEntryHtml(e, i) {
    const native = nativeLang();
    const tr = (e.tr || []).slice(0, 4).map((s) =>
        `<li><b lang="${native === "cmn" ? "zh" : native}">${escapeHtml(s.words.join(", "))}</b>${s.gloss ? ` <small>${escapeHtml(s.gloss)}</small>` : ""}</li>`).join("");
    const defs = e.senses.slice(0, 8).map((s) =>
        `<li><small>${escapeHtml(s.pos.join(", "))}</small> ${escapeHtml(s.gloss.join("; "))}${s.example ? ` <i class="def-example">“${escapeHtml(s.example)}”</i>` : ""}</li>`).join("");
    return `<div class="entry">
        <div class="entry-head">
            <span class="headword" lang="en">${escapeHtml(e.word)}</span>
            ${e.reading ? `<span class="reading ipa">${escapeHtml(e.reading)}</span>` : ""}
            ${e.audio ? `<button class="say" data-src="${escapeHtml(e.audio)}" title="listen (American)">🔊</button>` : ""}
            ${e.common ? `<span class="tag">common</span>` : ""}${freqHtml(e)}
            <button class="mine" data-i="${i}">+ mine</button>
        </div>
        ${tr ? `<div class="translations" translate="no"><span class="tr-lang">${escapeHtml(NATIVE_LANGUAGES[native] || native)}</span><ol>${tr}</ol></div>` : ""}
        ${defs ? `<ol class="defs" translate="no" lang="en">${defs}</ol>` : ""}
        ${!tr && !defs ? `<p class="muted">no definition found (the definitions and translations need an internet connection).</p>` : ""}
    </div>`;
}

// ---------- drawing ----------

function render(word, { entries, inflection, kanji, grammar = [], more = [], expression = null }) {
    const en = target() === "en";
    const body = entries.length ? entries.map((e, i) => {
        if (en) return englishEntryHtml(e, i);
        const senses = e.senses.slice(0, 5).map((s) =>
            `<li>${escapeHtml(s.gloss.join("; "))}`
            + (s.pos.length ? ` <small>${escapeHtml(s.pos.join(", "))}</small>` : "")
            + (s.misc.length ? ` <small class="misc">${escapeHtml(s.misc.join(", "))}</small>` : "")
            + `</li>`).join("");
        return `<div class="entry">
            <div class="entry-head">
                <span class="headword" lang="ja">${escapeHtml(e.word)}</span>
                ${readingHtml(e)}
                <button class="say-word" data-i="${i}" title="hear the word">🔊</button>
                ${e.common ? `<span class="tag">common</span>` : ""}${freqHtml(e)}
                <button class="mine" data-i="${i}">+ mine</button>
            </div>
            ${e.forms.length ? `<div class="forms" lang="ja">also: ${escapeHtml(e.forms.join("、"))}</div>` : ""}
            <ol translate="no">${senses}</ol>
        </div>`;
    }).join("") : more.length ? "" : `<p class="muted">no dictionary entry for this. try selecting a longer or shorter bit of text.</p>`;

    const lemma = ctx && ctx.lemma;
    const link = en
        ? `<a href="https://www.merriam-webster.com/dictionary/${encodeURIComponent(lemma || word)}" target="_blank" rel="noopener">Merriam-Webster ↗</a>`
        : `<a href="https://jisho.org/search/${encodeURIComponent(lemma || word)}" target="_blank" rel="noopener">jisho ↗</a>`;
    popup.innerHTML = `<div class="popup-head"><b lang="${target()}">${escapeHtml(word)}</b>
        ${lemma && lemma.toLowerCase() !== word.toLowerCase() ? `<span class="lemma" lang="${target()}">→ ${escapeHtml(lemma)}</span>` : ""}
        ${link}
        ${!en && ctx && ctx.sentence && ctx.sentence.length > 1 ? `<button class="say-sentence" title="hear the whole sentence">▶ sentence</button>` : ""}
        <button class="close" title="close">✕</button></div>
        ${expressionHtml(expression)}
        ${inflectionHtml(lemma || word, inflection)}
        ${grammarHtml(grammar)}
        ${lemma ? statusButtons(lemma) : ""}${body}${moreHtml(more)}${kanjiHtml(kanji)}`;

    popup.querySelectorAll(".mine:not(.more-mine):not(.expr-mine)").forEach((btn) => btn.addEventListener("click", () =>
        mineEntry(entries[Number(btn.dataset.i)], btn)));
    // the expression: mined as itself, the whole phrase in bold in the sentence
    popup.querySelector(".expr-mine")?.addEventListener("click", (e) =>
        mineEntry(expression.entry, e.currentTarget, { lemma: expression.key, word: expression.text || expression.key }));
    popup.querySelectorAll(".more-mine").forEach((btn) => btn.addEventListener("click", () =>
        mineEntry(minable(more[Number(btn.dataset.d)].entries[Number(btn.dataset.e)]), btn)));
    // remember whether the kanji section is open
    const box = popup.querySelector(".kanji-box");
    if (box) box.addEventListener("toggle", () => store.set(KANJI_OPEN, box.open));
    // and which added dictionaries are folded away
    popup.querySelectorAll(".more-dict").forEach((d) => d.addEventListener("toggle", () => {
        const closed = store.get(MORE_CLOSED, []).filter((t) => t !== d.dataset.title);
        store.set(MORE_CLOSED, d.open ? closed : [...closed, d.dataset.title]);
    }));
    popup.querySelectorAll(".say").forEach((b) => b.addEventListener("click", () => new Audio(b.dataset.src).play().catch(() => {})));
    // Japanese: hear the word, or the whole sentence it's in
    const failed = (err) => toast(err.message, true);
    popup.querySelectorAll(".say-word").forEach((b) => b.addEventListener("click", () => {
        const e = entries[Number(b.dataset.i)];
        sayWord(e.word, e.reading || "").catch(failed);
    }));
    popup.querySelector(".say-sentence")?.addEventListener("click", () => saySentence(ctx.sentence).catch(failed));
}

// as: for an expression, its key (its status) and its text as written here (bold in the card)
async function mineEntry(entry, btn, as = null) {
    const auto = anki.auto();
    btn.disabled = true;
    btn.textContent = auto ? "→ Anki…" : "✓ mined";
    // mining a word means you're learning it (unless you already know it)
    const lemma = as ? as.lemma : (ctx && ctx.lemma) || entry.word;
    if (wordStatus(lemma) === "new") {
        if (as) setExpressionStatus(lemma, "learning");
        else if (ctx && ctx.lemma) setPopupStatus("learning");
        else setWordStatus(lemma, "learning");
    }
    const c = as ? { ...(ctx || {}), word: as.word } : ctx || {};
    // an English word's card gets your translation first, then the English definition
    if (entry.tr && entry.tr.length) {
        entry = { ...entry, senses: [{ pos: [], gloss: [[...new Set(entry.tr.slice(0, 2).flatMap((s) => s.words.slice(0, 3)))].slice(0, 4).join(", ")], misc: [] }, ...entry.senses] };
    }
    const ok = await mining.mine(entry, { word: c.word, sentence: c.sentence, info: c.info || {}, media: hooks.media(c.info || {}) });
    if (auto) btn.textContent = ok ? "✓ in Anki" : "✓ mined (Anki failed)";
}

// Position next to the word. Normally relative to the page; in full screen relative to the
// full-screen element (the popup sits inside it then).
function place(anchor) {
    const rect = anchor.getBoundingClientRect();
    const fs = document.fullscreenElement;
    const origin = fs ? fs.getBoundingClientRect() : { left: -window.scrollX, top: -window.scrollY };
    const width = Math.min(360, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
    popup.style.width = width + "px";
    popup.style.left = left - origin.left + "px";
    // prefer above the word (subs sit at the bottom of the video)
    const above = rect.top > 320;
    popup.style.top = (above ? rect.top - 8 : rect.bottom + 8) - origin.top + "px";
    popup.classList.toggle("above", above);
}

export function closePopup() {
    if (popup.hidden) return;
    popup.hidden = true;
    if (ctx) hooks.onClose(ctx.resume);
    ctx = null;
}

// where the popup normally lives in the page
const home = popup.parentElement;

// ---------- clicking in text ----------

// Make words inside `container` clickable. lineSelector finds the line/paragraph around a click;
// contextFor(lineEl, wordEl) returns {sentence, info} for it (sentence defaults to the line's text).
export function enableWordClicks(container, lineSelector, contextFor = () => ({})) {
    container.addEventListener("mouseup", (e) => {
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        const lineEl = e.target.closest(lineSelector);
        if (!lineEl || !container.contains(lineEl)) return;
        const w = e.target.closest(".w");
        const c = contextFor(lineEl, w) || {};
        const sentence = c.sentence ?? plainText(lineEl).trim();

        // selected text, minus any furigana that got caught in the selection
        const frag = range && !range.collapsed ? range.cloneContents() : null;
        if (frag) frag.querySelectorAll("rt").forEach((rt) => rt.remove());
        // Japanese has no spaces between words (and selections pick up line breaks); English keeps one between words
        const selected = !frag ? "" : learningEnglish() ? frag.textContent.replace(/\s+/g, " ").trim() : frag.textContent.replace(/\s+/g, "");

        if (selected && lineEl.contains(sel.anchorNode)) {
            lookup(selected, { sentence, info: c.info, anchor: { getBoundingClientRect: () => range.getBoundingClientRect() } });
        } else if (w) {
            const grammar = w.dataset.gr ? w.dataset.gr.split(" ") : [];
            const expression = w.dataset.ex ? { key: w.dataset.ex, kind: w.dataset.et, text: expressionText(w) } : null;
            lookup(plainText(w), { sentence, info: c.info, anchor: w, lemma: w.dataset.b, grammar, expression });
        }
    });
}

export function init() {
    popup.addEventListener("click", (e) => {
        const btn = e.target.closest(".st");
        const key = btn && btn.closest("[data-key]")?.dataset.key;
        if (btn && key) setExpressionStatus(key, btn.dataset.status);
        else if (btn) setPopupStatus(btn.dataset.status);
        if (e.target.classList.contains("close")) closePopup();
    });
    document.addEventListener("mousedown", (e) => {
        if (!popup.hidden && !popup.contains(e.target) && !e.target.closest(".w")) closePopup();
    });
    // leaving full screen: close the popup and put it back in the page
    document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement) return;
        closePopup();
        if (popup.parentElement !== home) home.appendChild(popup);
    });
}
