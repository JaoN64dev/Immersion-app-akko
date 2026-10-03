// Drawing subtitles: the overlay on the video, the transcript, and the comprehension %

import { el } from "../core/dom.js";
import { state } from "../core/state.js";
import { timeFormatter } from "../core/utils.js";
import { pctLevel } from "../words/status.js";
import { tokensHtml, plainHtml, unknownIn, comprehension } from "../words/render.js";
import { activeCues, cueIndexAt } from "./cues.js";
import * as progress from "../progress.js";
import * as subs2 from "./subs2.js";
import { understood } from "../core/target.js";

let shownKey = "";         // which cues the overlay is showing, to skip needless redraws

const cueHtml = (cue) => (cue.tokens ? tokensHtml(cue.tokens) : plainHtml(cue.text));

// ---------- overlay + transcript ----------

export function renderSubtitle() {
    subs2.render();
    const t = el.video.currentTime;
    const active = activeCues(t);
    const key = active.map((c) => c.start + c.text).join("|");
    if (key !== shownKey) {
        shownKey = key;
        el.overlay.innerHTML = active.map((c) =>
            `<div class="line" data-cue="${state.cues.indexOf(c)}">${cueHtml(c)}</div>`).join("");
    }

    const idx = cueIndexAt(t);
    if (idx !== state.activeIdx) {
        const prev = el.transcript.children[state.activeIdx];
        if (prev) prev.classList.remove("active");
        state.activeIdx = idx;
        const cur = el.transcript.children[idx];
        if (cur) {
            cur.classList.add("active");
            // don't scroll while the mouse is over the transcript: words would slide under the cursor
            if (el.follow.checked && !el.transcript.matches(":hover")) {
                el.transcript.scrollTo({ top: cur.offsetTop - el.transcript.clientHeight / 3, behavior: "smooth" });
            }
        }
    }
}

// redraw the overlay and re-find the active line (after the delay changes)
export function forceRedraw() {
    shownKey = "";
    state.activeIdx = -2;
    renderSubtitle();
}

export function renderTranscript() {
    el.transcript.innerHTML = state.cues.map((c) => {
        const i1 = c.tokens && unknownIn(c.tokens).size === 1;
        return `<li${i1 ? ` class="i1"` : ""}><time>${timeFormatter(c.start)}</time>`
            + `<span class="text">${cueHtml(c)}</span>${i1 ? `<span class="badge" title="exactly one unknown word">i+1</span>` : ""}</li>`;
    }).join("");
}

// re-colour everything after a word's status changes, without jumping the transcript
export function refreshWords() {
    const top = el.transcript.scrollTop;
    renderTranscript();
    el.transcript.scrollTop = top;
    const cur = el.transcript.children[state.activeIdx];
    if (cur) cur.classList.add("active");
    shownKey = "";
    renderSubtitle();
    renderStats();
}

// ---------- comprehension % ----------

export function renderStats() {
    const { wordStats: stats, compBadge: badge } = el;
    if (!state.cues.length || !state.cues[0].tokens) { stats.textContent = ""; badge.hidden = true; return; }
    const c = comprehension(state.cues.map((cue) => cue.tokens));
    stats.textContent = `${c.unknown} unknown · ${c.iPlus1} i+1`;
    stats.title = `${c.unknown} different words you don't know yet.\n${c.iPlus1} lines have exactly one unknown word (best for mining).`;
    badge.hidden = false;
    badge.className = "comp-badge " + pctLevel(c.pct);
    badge.innerHTML = `<b>${c.pct}%</b> ${understood()}`;
    badge.title = `you know ${c.known} of the ${c.total} words in this episode (ignored words don't count)`;
    progress.update({ pct: c.pct });
}

export function init() {
    window.addEventListener("akko-words-changed", refreshWords);
}
