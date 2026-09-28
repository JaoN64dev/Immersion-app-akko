// Playing an episode: the audio, its transcript (clickable, following along), and
// remembering how far you got in each episode

import { $ } from "../core/dom.js";
import { store, escapeHtml, timeFormatter } from "../core/utils.js";
import { pctLevel } from "../words/status.js";
import { tokenize, tokensHtml, plainHtml, recolor, comprehension } from "../words/render.js";
import { bindWordDisplay } from "../words/display.js";
import { watchHover } from "../words/hover.js";
import { enableWordClicks } from "../popup.js";
import { fetchText, parseTranscript, pickTranscript } from "./feed.js";
import { setPresence, tickPresence } from "../core/presence.js";

const PROGRESS = "akko-podcast-progress";

const ui = {
    section: $("#pod-player"), audio: $("#pod-audio"), art: $("#pod-now-art"),
    title: $("#pod-now-title"), show: $("#pod-now-show"),
    back: $("#pod-back"), fwd: $("#pod-fwd"), speed: $("#pod-speed"), autoPause: $("#pod-autopause"),
    file: $("#pod-transcript-file"), transcript: $("#pod-transcript"), status: $("#pod-transcript-status"),
    stats: $("#pod-stats"), badge: $("#pod-badge"), follow: $("#pod-follow"),
};

let episode = null;
let podcast = null;
let cues = [];
let activeIdx = -1;
let pauseAt = null;
let job = 0;
let lastSave = 0;
let onProgress = () => {};

export const audio = ui.audio;
export const current = () => ({ episode, podcast });

// ---------- progress per episode ----------

export const progressOf = (guid) => store.get(PROGRESS, {})[guid];

function saveProgress() {
    if (!episode || !isFinite(ui.audio.duration)) return;
    const all = store.get(PROGRESS, {});
    const time = ui.audio.currentTime, duration = ui.audio.duration;
    all[episode.guid] = { time, duration, done: time / duration > 0.95, updated: Date.now() };
    store.set(PROGRESS, all);
    onProgress();
}

// ---------- playing ----------

// What to show on Discord: the podcast as the "show", the episode + playback position under it.
function updatePresence(paused, throttled = false) {
    if (!episode) return;
    const time = isFinite(ui.audio.duration) ? `${timeFormatter(ui.audio.currentTime)} / ${timeFormatter(ui.audio.duration)}` : timeFormatter(ui.audio.currentTime);
    const payload = { type: 2, details: podcast ? podcast.title : episode.title, state: `${paused ? "⏸ " : "▶ "}${episode.title} — ${time}` };
    (throttled ? tickPresence : setPresence)(payload);
}

export function play(ep, pod) {
    saveProgress();
    job++;
    episode = ep;
    podcast = pod;
    ui.section.hidden = false;
    ui.art.src = ep.image || pod.image || pod.art || "";
    ui.title.textContent = ep.title;
    ui.show.textContent = pod.title;
    ui.audio.src = ep.audio;
    ui.audio.playbackRate = Number(ui.speed.value);

    const saved = progressOf(ep.guid);
    if (saved && !saved.done && saved.time > 5) {
        ui.audio.addEventListener("loadedmetadata", () => { ui.audio.currentTime = saved.time; }, { once: true });
    }
    ui.audio.play().catch(() => {});
    updatePresence(false);
    ui.section.scrollIntoView({ behavior: "smooth" });

    setCues([]);
    if (ep.transcripts.length) loadTranscript(pickTranscript(ep.transcripts), job);
    else ui.status.textContent = "this episode has no transcript. you can still listen, or load your own (.srt / .vtt / .txt).";
}

async function loadTranscript(t, myJob) {
    ui.status.textContent = "loading transcript…";
    try {
        const { text, type } = await fetchText(t.url);
        if (myJob !== job) return;
        setCues(parseTranscript(text, t.type || type, t.url));
        ui.status.textContent = "";
    } catch (err) {
        if (myJob === job) ui.status.textContent = "couldn't load the transcript: " + err.message;
    }
}

async function setCues(list) {
    cues = list;
    activeIdx = -1;
    pauseAt = null;
    renderTranscript();
    renderStats();
    if (!list.length) return;
    const myJob = job;
    try {
        const tokens = await tokenize(list.map((c) => c.text));
        if (myJob !== job || cues !== list) return;
        list.forEach((c, i) => { c.tokens = tokens[i]; });
        renderTranscript();
        renderStats();
    } catch { /* stays plain */ }
}

// ---------- transcript ----------

const timed = () => cues.length && cues[0].start !== null;

function renderTranscript() {
    ui.transcript.classList.toggle("untimed", !timed());
    ui.transcript.innerHTML = cues.map((c) =>
        `<li>${c.start !== null ? `<time>${timeFormatter(c.start)}</time>` : ""}<span class="text">${c.tokens ? tokensHtml(c.tokens) : plainHtml(c.text)}</span></li>`).join("");
    activeIdx = -1;
    follow();
}

function renderStats() {
    if (!cues.length || !cues[0].tokens) { ui.stats.textContent = ""; ui.badge.hidden = true; return; }
    const c = comprehension(cues.map((cue) => cue.tokens));
    ui.stats.textContent = `${c.unknown} unknown`;
    ui.badge.hidden = false;
    ui.badge.className = "comp-badge inline " + pctLevel(c.pct);
    ui.badge.innerHTML = `<b>${c.pct}%</b> 理解`;
    ui.badge.title = `you know ${c.known} of the ${c.total} words in this episode (ignored words don't count)`;
}

// index of the last cue that has started
function cueAt(t) {
    let ans = -1;
    for (let i = 0; i < cues.length && cues[i].start <= t; i++) ans = i;
    return ans;
}

function follow() {
    if (!timed()) return;
    const idx = cueAt(ui.audio.currentTime);
    if (idx === activeIdx) return;
    ui.transcript.children[activeIdx]?.classList.remove("active");
    activeIdx = idx;
    const li = ui.transcript.children[idx];
    if (!li) return;
    li.classList.add("active");
    // don't scroll while the mouse is over the transcript: words would slide under the cursor
    if (ui.follow.checked && !ui.transcript.matches(":hover")) {
        ui.transcript.scrollTo({ top: li.offsetTop - ui.transcript.clientHeight / 3, behavior: "smooth" });
    }
}

// auto-pause at the end of each line
function checkAutoPause() {
    if (!ui.autoPause.checked || ui.audio.paused || !timed()) { pauseAt = null; return; }
    const c = cues[cueAt(ui.audio.currentTime)];
    if (c && pauseAt === null && ui.audio.currentTime < c.end) pauseAt = c.end;
    if (pauseAt !== null && ui.audio.currentTime >= pauseAt - 0.05) { ui.audio.pause(); pauseAt = null; }
}

export function seekToCue(i) {
    const c = cues[i];
    if (!c || c.start === null) return;
    ui.audio.currentTime = c.start + 0.01;
    pauseAt = null;
    ui.audio.play().catch(() => {});
}
export const prevLine = () => {
    const i = cueAt(ui.audio.currentTime);
    seekToCue(cues[i] && ui.audio.currentTime - cues[i].start > 1 ? i : i - 1);
};
export const replayLine = () => seekToCue(Math.max(0, cueAt(ui.audio.currentTime)));
export const nextLine = () => seekToCue(cueAt(ui.audio.currentTime) + 1);
export const skip = (s) => { ui.audio.currentTime = Math.max(0, ui.audio.currentTime + s); };
export const togglePlay = () => (ui.audio.paused ? ui.audio.play().catch(() => {}) : ui.audio.pause());

export function init({ onProgressChange }) {
    onProgress = onProgressChange;
    bindWordDisplay($("#furigana-mode"), $("#color-words"));
    ui.speed.value = String(store.get("akko-pod-speed", 1));
    ui.speed.addEventListener("input", () => {
        ui.audio.playbackRate = Number(ui.speed.value);
        store.set("akko-pod-speed", Number(ui.speed.value));
    });
    ui.back.addEventListener("click", () => skip(-10));
    ui.fwd.addEventListener("click", () => skip(10));

    ui.audio.addEventListener("timeupdate", () => {
        follow();
        checkAutoPause();
        if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveProgress(); }
        updatePresence(ui.audio.paused, true);
    });
    ui.audio.addEventListener("pause", () => { saveProgress(); updatePresence(true); });
    ui.audio.addEventListener("play", () => { pauseAt = null; updatePresence(false); });
    window.addEventListener("pagehide", saveProgress);

    ui.file.addEventListener("change", async () => {
        const f = ui.file.files[0];
        ui.file.value = "";
        if (!f) return;
        job++;
        setCues(parseTranscript(await f.text(), "", f.name));
        ui.status.textContent = `transcript: ${f.name}`;
    });

    // click a line (not a word) to jump there
    ui.transcript.addEventListener("click", (e) => {
        if (e.target.closest(".w")) return;
        const li = e.target.closest("li");
        if (li) seekToCue([...ui.transcript.children].indexOf(li));
    });
    enableWordClicks(ui.transcript, "li", (li) => {
        const c = cues[[...ui.transcript.children].indexOf(li)];
        return {
            sentence: c ? c.text : undefined,
            info: {
                source: [podcast && podcast.title, episode && episode.title].filter(Boolean).join(" — "),
                time: timeFormatter(ui.audio.currentTime),
            },
        };
    });
    watchHover(ui.transcript);

    window.addEventListener("akko-words-changed", () => {
        recolor(ui.transcript);
        renderStats();
    });
}
