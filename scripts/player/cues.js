// Subtitle lines on the timeline: loading, delay, line navigation, auto-pause

import { el } from "../core/dom.js";
import { state } from "../core/state.js";
import { parseSubtitle } from "../subtitles/parse.js";
import { tokenize } from "../words/render.js";
import { renderSubtitle, renderTranscript, renderStats, refreshWords, forceRedraw } from "./render.js";
import { updateNowPlaying } from "./video.js";
import * as progress from "../progress.js";

let pauseAt = null;        // auto-pause target time

export const cueStart = (c) => c.start + state.offset;
export const cueEnd = (c) => c.end + state.offset;

export function activeCues(t) {
    return state.cues.filter((c) => t >= cueStart(c) && t < cueEnd(c));
}

// index of the last cue that has started at time t
export function cueIndexAt(t) {
    let lo = 0, hi = state.cues.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cueStart(state.cues[mid]) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
}

// ---------- loading ----------

// restoring = reloading the subs saved for this video (don't scroll, don't overwrite the save)
export function loadSubtitleText(text, ext, name, { restoring = false } = {}) {
    state.cues = parseSubtitle(text, ext);
    state.subName = name;
    state.subRaw = { text, ext, name };
    state.subRestored = restoring;
    state.activeIdx = -1;
    pauseAt = null;
    setOffset(0);
    renderTranscript();
    renderStats();
    updateNowPlaying();
    renderSubtitle();
    tokenizeCues(state.cues);
    if (!restoring) {
        progress.saveSub(state.subRaw);
        document.getElementById("player-section").scrollIntoView({ behavior: "smooth" });
    }
}

// No subtitles (moving on to another episode: its own are loaded, or picked, for it)
export function clearSubs() {
    state.cues = [];
    state.subName = "";
    state.subRaw = null;
    state.subRestored = false;
    state.activeIdx = -1;
    pauseAt = null;
    setOffset(0);
    renderTranscript();
    renderStats();
    updateNowPlaying();
    renderSubtitle();
}

// Split every line into words (colours, furigana, % known)
async function tokenizeCues(cues) {
    try {
        const tokens = await tokenize(cues.map((c) => c.text));
        if (state.cues !== cues) return;
        cues.forEach((c, i) => { c.tokens = tokens[i]; });
        refreshWords();
    } catch { /* server never came up: lines stay plain but clickable */ }
}

// ---------- delay ----------

export function setOffset(v) {
    state.offset = Math.round(v * 10) / 10;
    el.offsetValue.textContent = (state.offset > 0 ? "+" : "") + state.offset.toFixed(1) + "s";
    progress.update({ offset: state.offset });
    forceRedraw();
}

export const nudgeOffset = (by) => setOffset(state.offset + by);

// Shift everything so the next line (the one you just heard) starts now
function syncToNow() {
    const t = el.video.currentTime;
    const c = state.cues[cueIndexAt(t) + 1] || state.cues[state.cues.length - 1];
    if (c) setOffset(t - c.start);
}

// ---------- line navigation ----------

export function seekToCue(idx, play = true) {
    const c = state.cues[idx];
    if (!c) return;
    el.video.currentTime = Math.max(0, cueStart(c) + 0.01);
    pauseAt = null;
    if (play && el.video.src) el.video.play();
}

export const prevLine = () => {
    const idx = cueIndexAt(el.video.currentTime);
    const c = state.cues[idx];
    // if we're more than 1s into the line, go to its start; otherwise the previous line
    seekToCue(c && el.video.currentTime - cueStart(c) > 1 ? idx : idx - 1);
};
export const replayLine = () => seekToCue(Math.max(0, cueIndexAt(el.video.currentTime)));
export const nextLine = () => seekToCue(cueIndexAt(el.video.currentTime) + 1);

// ---------- playback loop ----------

// auto-pause at the end of each line
function checkAutoPause() {
    const t = el.video.currentTime;
    if (!el.autoPause.checked || el.video.paused || state.recording) { pauseAt = null; return; }
    const cur = activeCues(t).pop();
    if (cur && pauseAt === null) pauseAt = cueEnd(cur);
    if (pauseAt !== null && t >= pauseAt - 0.05) {
        el.video.pause();
        pauseAt = null;
    }
}

// timeupdate is too coarse (~4/s) for subs, so poll with rAF while playing
function tick() {
    renderSubtitle();
    checkAutoPause();
    if (!el.video.paused) requestAnimationFrame(tick);
}

export function init() {
    el.video.addEventListener("play", () => { pauseAt = null; requestAnimationFrame(tick); });
    el.video.addEventListener("seeked", renderSubtitle);
    el.video.addEventListener("timeupdate", () => { if (el.video.paused) renderSubtitle(); });

    el.prevLine.addEventListener("click", prevLine);
    el.replayLine.addEventListener("click", replayLine);
    el.nextLine.addEventListener("click", nextLine);
    el.offsetMinus.addEventListener("click", () => nudgeOffset(-0.1));
    el.offsetPlus.addEventListener("click", () => nudgeOffset(0.1));
    el.syncHere.addEventListener("click", syncToNow);

    // click a transcript line (not a word) to jump there
    el.transcript.addEventListener("click", (e) => {
        if (e.target.closest(".w")) return;
        const li = e.target.closest("li");
        if (li) seekToCue([...el.transcript.children].indexOf(li));
    });
}
