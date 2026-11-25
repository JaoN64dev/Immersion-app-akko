// Look up a word (3.0, feature 11's handwriting half): type or paste a word, or draw a kanji you
// can't type, and it opens in the usual word popup (meanings, kanji, stroke order, mining…).
// Opened from the page's menu or with / (scripts/popup.js adds both on the pages that have a popup).
//
// The drawing is recognised in the browser by KanjiCanvas (Dominik Klein, MIT licence,
// https://github.com/asdfjkl/kanjicanvas), loaded from a pinned commit the first time is used —
// any stroke order, any stroke count. Nothing is sent anywhere.

import { escapeHtml, loadScript } from "../core/utils.js";
import { target } from "../core/target.js";
import { t } from "../i18n.js";

const KANJICANVAS = "https://cdn.jsdelivr.net/gh/asdfjkl/kanjicanvas@a9214105f156def3b96930e5fcf10b7652b7a1f7/docs/resources/javascript/";
const PAD = "akko-handwriting-pad";

let dialog = null;
let onLookup = () => {};
let canvasReady = null;

async function loadKanjiCanvas() {
    if (!canvasReady) {
        canvasReady = (async () => {
            await loadScript(KANJICANVAS + "kanji-canvas.min.js");
            await loadScript(KANJICANVAS + "ref-patterns.js");          // the reference shapes (big, once)
            window.KanjiCanvas.init(PAD);
        })().catch((err) => { canvasReady = null; throw err; });
    }
    return canvasReady;
}

function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "lookup-dialog";
    dialog.innerHTML = `
        <form method="dialog" class="lookup-form">
            <input class="lookup-input" type="search" autocomplete="off">
            <button type="submit" class="lookup-go">look up</button>
            <button type="button" class="lookup-draw" title="">draw</button>
            <button type="button" class="lookup-close" title="">✕</button>
        </form>
        <div class="lookup-pad" hidden>
            <canvas id="${PAD}" class="lookup-canvas" width="256" height="256"></canvas>
            <div class="lookup-side">
                <div class="lookup-candidates" lang="ja"></div>
                <div class="lookup-pad-buttons">
                    <button type="button" class="lookup-undo">↶</button>
                    <button type="button" class="lookup-clear">✕</button>
                </div>
                <p class="hint lookup-pad-hint"></p>
                <p class="hint lookup-credit"><a href="https://github.com/asdfjkl/kanjicanvas" target="_blank" rel="noopener">KanjiCanvas</a> © Dominik Klein (MIT)</p>
            </div>
        </div>`;
    const input = dialog.querySelector(".lookup-input");
    const pad = dialog.querySelector(".lookup-pad");
    const candidates = dialog.querySelector(".lookup-candidates");
    const say = (text) => { dialog.querySelector(".lookup-pad-hint").textContent = text; };

    dialog.querySelector(".lookup-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const word = input.value.trim();
        if (!word) return;
        dialog.close();
        onLookup(word);
    });
    dialog.querySelector(".lookup-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

    //: the drawing pad. Each stroke lifted: the best guesses, tap one to add it to the word
    const recognise = () => {
        const K = window.KanjiCanvas;
        if (!K || !K["recordedPattern_" + PAD] || !K["recordedPattern_" + PAD].length) { candidates.innerHTML = ""; return; }
        const found = String(K.recognize(PAD) || "").trim().split(/\s+/).filter(Boolean).slice(0, 10);
        candidates.innerHTML = found.map((c) => `<button type="button" class="lookup-candidate">${escapeHtml(c)}</button>`).join("");
    };
    dialog.querySelector(".lookup-draw").addEventListener("click", async () => {
        pad.hidden = !pad.hidden;
        if (pad.hidden) return;
        say(t("loading the handwriting recognition… (the first time only)"));
        try {
            await loadKanjiCanvas();
            say(t("draw one kanji: any stroke order is fine. Tap a guess to add it to the word."));
        } catch {
            say(t("the handwriting recognition needs the internet the first time"));
        }
    });
    const canvas = dialog.querySelector(".lookup-canvas");
    for (const ev of ["mouseup", "touchend"]) canvas.addEventListener(ev, () => setTimeout(recognise, 0));
    dialog.querySelector(".lookup-undo").addEventListener("click", () => { window.KanjiCanvas?.deleteLast(PAD); recognise(); });
    dialog.querySelector(".lookup-clear").addEventListener("click", () => { window.KanjiCanvas?.erase(PAD); candidates.innerHTML = ""; });
    candidates.addEventListener("click", (e) => {
        const b = e.target.closest(".lookup-candidate");
        if (!b) return;
        input.value += b.textContent;
        window.KanjiCanvas?.erase(PAD);
        candidates.innerHTML = "";
        input.focus();
    });
    return dialog;
}

// lookup(word): what to do with the word (the popup's lookup)
export function openLookup(lookup) {
    onLookup = lookup;
    const d = ensureDialog();
    const host = document.fullscreenElement || document.body;
    if (d.parentElement !== host) host.append(d);
    const input = d.querySelector(".lookup-input");
    input.placeholder = t("type, paste or draw a word…");
    input.lang = target();
    d.querySelector(".lookup-draw").title = t("draw a kanji you can't type");
    d.querySelector(".lookup-close").title = t("close");
    // the drawing pad is for kanji: shown for Japanese (and Chinese, which shares most of them)
    d.querySelector(".lookup-draw").hidden = !["ja", "cmn", "yue", "zh"].includes(target());
    input.value = "";
    if (!d.open) d.showModal();
    input.focus();
}
