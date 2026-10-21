// Turning Japanese (or English) text into clickable, coloured words (used by every page)

import { escapeHtml, postJson, store } from "../core/utils.js";
import { wordStatus, counts, isUnknown } from "./status.js";
import { target, keyFor } from "../core/target.js";

// The expressions met so far (idioms seen in a text, any expression given a status in the popup):
// key -> when first met, for the stats page's "idioms known / met". Saved a moment later, once.
export const EXPRESSIONS_KEY = keyFor("akko-expressions");
let metLater = null;
export function noteExpression(key) {
    if (!metLater) {
        metLater = new Set();
        setTimeout(() => {
            const met = store.get(EXPRESSIONS_KEY, {});
            let added = false;
            for (const k of metLater) if (!met[k]) { met[k] = Date.now(); added = true; }
            metLater = null;
            if (added) store.set(EXPRESSIONS_KEY, met);
        }, 1000);
    }
    metLater.add(key);
}

const segmenter = "Segmenter" in Intl ? new Intl.Segmenter(target(), { granularity: "word" }) : null;

// A token from /api/tokenize: {s: surface, b: dictionary form, f: furigana parts, c: counts as a word, n: name,
// gr: ids of grammar lessons it's part of, ex: the expression it's part of (首を長くする, give up),
// et: that expression's kind ("i" idiom: underlined, "p" everyday phrase: popup only; server/expressions.js)}.
// offset (optional) = where the token starts in its line, kept as data-o for finding the sentence.
export function tokenHtml(t, offset) {
    if (t.s === "\n") return "<br>";
    if (!t.b) return escapeHtml(t.s);
    const inner = t.f
        ? t.f.map((p) => p.r ? `<ruby>${escapeHtml(p.t)}<rt>${escapeHtml(p.r)}</rt></ruby>` : escapeHtml(p.t)).join("")
        : escapeHtml(t.s);
    const cls = t.c ? `w s-${wordStatus(t.b)}` : t.n ? "w name" : "w g";
    const gr = t.gr ? ` data-gr="${escapeHtml(t.gr.join(" "))}"` : "";
    if (t.ex && t.et === "i") noteExpression(t.ex);
    const ex = t.ex ? ` data-ex="${escapeHtml(t.ex)}" data-et="${t.et === "i" ? "i" : "p"}" data-exs="${wordStatus(t.ex)}"` : "";
    return `<span class="${cls}" data-b="${escapeHtml(t.b)}"${t.c ? ` data-c="1"` : ""}${gr}${ex}${offset !== undefined ? ` data-o="${offset}"` : ""}>${inner}</span>`;
}

export function tokensHtml(tokens, { offsets = false } = {}) {
    let at = 0;
    return tokens.map((t) => {
        const html = tokenHtml(t, offsets ? at : undefined);
        at += t.s.length;
        return html;
    }).join("");
}

// Until the server has tokenized a line: split with Intl.Segmenter (clickable, no colours)
export function plainHtml(text) {
    return text.split("\n").map((line) => {
        if (!segmenter) return escapeHtml(line);
        return [...segmenter.segment(line)].map((s) => s.isWordLike
            ? `<span class="w">${escapeHtml(s.segment)}</span>`
            : escapeHtml(s.segment)).join("");
    }).join("<br>");
}

// Re-colour words in place after statuses change (cheaper than re-rendering)
export function recolor(root) {
    root.querySelectorAll(".w[data-c]").forEach((w) => {
        const flash = w.classList.contains("flash");
        w.className = `w s-${wordStatus(w.dataset.b)}${flash ? " flash" : ""}`;
    });
    // an expression's underline goes once it's known
    root.querySelectorAll(".w[data-ex]").forEach((w) => { w.dataset.exs = wordStatus(w.dataset.ex); });
}

// The text of the whole expression a word is part of: the neighbouring words with the same data-ex
// (and, in English, the spaces between them)
export function expressionText(w) {
    const key = w.dataset.ex;
    const same = (n) => n && n.nodeType === 1 && n.dataset && n.dataset.ex === key;
    const gap = (n) => n && n.nodeType === 3 && /^[ \t]*$/.test(n.nodeValue);
    let first = w;
    for (;;) {
        let p = first.previousSibling;
        if (gap(p) && same(p.previousSibling)) p = p.previousSibling;
        if (!same(p)) break;
        first = p;
    }
    let text = "";
    for (let n = first; n; n = n.nextSibling) {
        if (same(n)) text += plainText(n);
        else if (gap(n) && same(n.nextSibling)) text += n.nodeValue;
        else break;
    }
    return text;
}

// text of an element without the furigana
export function plainText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("rt").forEach((rt) => rt.remove());
    return clone.textContent;
}

// English full stops that don't end a sentence: "Mr.", "Dr.", "etc.", "D.C.", "e.g."
const ABBREVIATION = /(?:^|[\s("“])(?:mr|mrs|ms|dr|st|jr|sr|prof|vs|etc|[a-z])$|(?:[a-z]\.)+[a-z]$/i;

// does the character at i end a sentence? (English also ends them with a full stop; Japanese uses 。)
function endsSentence(text, i, en) {
    const ch = text[i];
    if (!en) return /[。！？!?…\n]/.test(ch);
    if (/[!?…\n]/.test(ch)) return true;
    if (ch !== ".") return false;
    // "3.5", "a.m." and "D.C." keep going: a full stop ends a sentence only before a space or the end
    if (i + 1 < text.length && !/[\s"”')\]]/.test(text[i + 1])) return false;
    return !ABBREVIATION.test(text.slice(Math.max(0, i - 8), i));
}

// The sentence around position `at` in `text`
export function sentenceAround(text, at) {
    const en = target() === "en";
    let start = at;
    while (start > 0 && !endsSentence(text, start - 1, en)) start--;
    // a closing quote right after the full stop belongs to the sentence before ("Stop." She ran.)
    while (start < at && /[\s"”')\]」』）]/.test(text[start])) start++;
    let end = at;
    while (end < text.length && !endsSentence(text, end, en)) end++;
    while (end < text.length && /[。！？.!?…」』）)"”']/.test(text[end])) end++;    // keep the punctuation + closing quote
    return text.slice(start, end).trim();
}

// Split lines into words on the server; retries while its tokenizer is still starting up
export async function tokenize(lines, attempt = 0) {
    try {
        return (await postJson("/api/tokenize", { lines, lang: target() })).tokens;
    } catch (err) {
        if (attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 3000));
        return tokenize(lines, attempt + 1);
    }
}

// content words in a line you don't know yet
export const unknownIn = (tokens) => new Set(tokens.filter((t) => t.c && isUnknown(t.b)).map((t) => t.b));

// How much of these lines you know (counting repeats); i+1 = lines with exactly one unknown word
export function comprehension(lines) {
    let total = 0, known = 0, iPlus1 = 0;
    const unknown = new Set();
    for (const tokens of lines) {
        for (const t of tokens) {
            if (!t.c || !counts(t.b)) continue;
            total++;
            if (wordStatus(t.b) === "known") known++; else unknown.add(t.b);
        }
        if (unknownIn(tokens).size === 1) iPlus1++;
    }
    return { pct: total ? Math.round((known / total) * 100) : 0, total, known, unknown: unknown.size, iPlus1 };
}
