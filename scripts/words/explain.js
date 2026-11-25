// "explain" in the word popup: the whole sentence broken down (3.0, feature 20).
//
// Right away, from akko itself: every word with its dictionary form, reading and first meaning, and
// the grammar lessons the sentence contains. Then, when Ollama runs on this computer
// (server/assistant.js), a written explanation by a local model, streamed as it is written:
// a translation, the sentence word by word, the grammar, and what's easy to miss. Nothing leaves the
// computer either way.

import { escapeHtml, getJson, store } from "../core/utils.js";
import { target, nativeLang } from "../core/target.js";
import { t } from "../i18n.js";
import { tokenize } from "./render.js";
import { lessonMap } from "../grammar/lessons.js";
import { markdown } from "../grammar/markdown.js";

const SETTINGS = "akko-assistant";             // {model}: the Ollama model picked in Settings
let dialog = null;
let running = null;                            // the explanation being streamed (AbortController)

function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "explain-dialog";
    dialog.innerHTML = `
        <div class="explain-head"><b class="explain-title"></b><button type="button" class="explain-close" title="close">✕</button></div>
        <p class="explain-sentence"></p>
        <div class="explain-words"></div>
        <div class="explain-ai"></div>`;
    dialog.querySelector(".explain-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { if (running) running.abort(); running = null; });
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });     // click outside
    return dialog;
}

// akko's own breakdown: the words that count, each once, with a meaning from the dictionary
async function breakdown(sentence) {
    const lang = target();
    const [lines, lessons] = await Promise.all([tokenize([sentence], lang), lessonMap()]);
    const tokens = (lines[0] || []).filter((x) => x.b && x.s.trim());
    const seen = new Set();
    const words = [];
    for (const x of tokens) {
        if (seen.has(x.b + "|" + x.s)) continue;
        seen.add(x.b + "|" + x.s);
        const reading = x.f ? x.f.map((p) => p.r || p.t).join("") : "";
        words.push({ surface: x.s, base: x.b, reading: reading !== x.s ? reading : "", counted: !!x.c });
    }
    // meanings: one dictionary lookup per different word, at the same time
    await Promise.all(words.filter((w) => w.counted).map(async (w) => {
        try {
            const r = await getJson("/api/dict?" + new URLSearchParams({ q: w.base, form: w.surface, lang, native: nativeLang() }));
            const e = r.entries && r.entries[0];
            if (e) {
                w.meaning = (e.senses && e.senses[0] && e.senses[0].gloss || []).slice(0, 3).join("; ");
                if (!w.reading && e.reading && e.reading !== w.surface) w.reading = e.reading;
            }
        } catch { /* no meaning: the word still shows */ }
    }));
    const ids = [...new Set(tokens.flatMap((x) => x.gr || []))];
    const grammar = ids.map((id) => lessons.get(id)).filter(Boolean);
    return { words, grammar };
}

function renderBreakdown(box, { words, grammar }) {
    const rows = words.map((w) => `<tr>
        <td lang="${target()}">${escapeHtml(w.surface)}</td>
        <td lang="${target()}">${w.base !== w.surface ? escapeHtml(w.base) : ""}${w.reading ? ` <small>${escapeHtml(w.reading)}</small>` : ""}</td>
        <td>${escapeHtml(w.meaning || (w.counted ? "" : t("particle / ending")))}</td></tr>`).join("");
    box.innerHTML = `<table class="explain-table"><thead><tr><th>${escapeHtml(t("as written"))}</th><th>${escapeHtml(t("dictionary form"))}</th><th>${escapeHtml(t("meaning"))}</th></tr></thead><tbody>${rows}</tbody></table>`
        + (grammar.length ? `<p class="explain-grammar"><b>${escapeHtml(t("grammar"))}</b> ${grammar.map((l) =>
            `<a href="/grammar.html#${encodeURIComponent(l.id)}" target="_blank" rel="noopener"><span lang="${target()}">${escapeHtml(l.title)}</span>${l.meaning ? ` <small>${escapeHtml(l.meaning)}</small>` : ""}</a>`).join(" · ")}</p>` : "");
}

// The local model's explanation, streamed into the box as it is written
async function explainWithModel(box, sentence, found) {
    let status;
    try { status = await getJson("/api/assistant"); } catch { status = { running: false }; }
    if (!status.running || !status.models.length) {
        box.innerHTML = `<p class="hint">${escapeHtml(status.running
            ? t("For a written explanation, give Ollama a model: in a terminal, run  ollama pull qwen2.5:7b")
            : t("For a written explanation too, install Ollama (free, runs on this computer):"))}
            ${status.running ? "" : `<a href="/settings.html#assistant-section">${escapeHtml(t("how to set it up"))}</a>`}</p>`;
        return;
    }
    const model = status.models.includes(store.get(SETTINGS, {}).model) ? store.get(SETTINGS, {}).model : status.models[0];
    box.innerHTML = `<p class="hint explain-thinking">${escapeHtml(t("{model} is thinking… (on this computer; the first answer can take a while)").replace("{model}", model))}</p><div class="explain-text"></div>`;
    const out = box.querySelector(".explain-text");
    running = new AbortController();
    try {
        const res = await fetch("/api/assistant/explain", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: running.signal,
            body: JSON.stringify({
                sentence, lang: target(), native: nativeLang() || "en", model,
                words: found.words.map((w) => ({ surface: w.surface, base: w.base })),
                grammar: found.grammar.map((l) => l.title + (l.meaning ? ` (${l.meaning})` : "")),
            }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `request failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "", drawn = 0;
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            if (Date.now() - drawn > 120) { out.innerHTML = markdown(text); drawn = Date.now(); }
        }
        out.innerHTML = markdown(text);
        box.querySelector(".explain-thinking").textContent = t("written by {model} on this computer — a model can be wrong; the dictionary above is the reference").replace("{model}", model);
    } catch (err) {
        if (err.name === "AbortError") return;
        box.querySelector(".explain-thinking").textContent = t("the local model couldn't answer: ") + err.message;
    } finally {
        running = null;
    }
}

export async function explainSentence(sentence) {
    const d = ensureDialog();
    if (running) running.abort();
    const host = document.fullscreenElement || document.body;
    if (d.parentElement !== host) host.append(d);
    d.querySelector(".explain-title").textContent = t("the sentence, explained");
    const s = d.querySelector(".explain-sentence");
    s.textContent = sentence;
    s.lang = target();
    const words = d.querySelector(".explain-words");
    const ai = d.querySelector(".explain-ai");
    words.innerHTML = `<p class="hint">${escapeHtml(t("analysing…"))}</p>`;
    ai.innerHTML = "";
    if (!d.open) d.showModal();
    let found = { words: [], grammar: [] };
    try {
        found = await breakdown(sentence);
        renderBreakdown(words, found);
    } catch (err) {
        words.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
    }
    explainWithModel(ai, sentence, found);
}

export { SETTINGS as ASSISTANT_SETTINGS };
