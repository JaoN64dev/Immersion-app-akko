// Pick up where you left off. Per video: position, subtitle file (the text itself),
// delay, audio track, anime and comprehension %. Also the "continue watching" row.

import { $, el } from "./core/dom.js";
import { state } from "./core/state.js";
import { store, escapeHtml, timeFormatter, episodeOf } from "./core/utils.js";
import { pctLevel } from "./words/status.js";
import { loadSubtitleText, setOffset } from "./player/cues.js";
import { reopen } from "./player/video.js";
import * as subs2 from "./player/subs2.js";
import { keyFor, understood } from "./core/target.js";

export const KEY = keyFor("akko-progress");
const SUB_PREFIX = "akko-subtext:";
const SUB2_PREFIX = "akko-subtext2:";    // 2nd subs (translation)
const KEEP = 40;          // videos remembered
const KEEP_SUBS = 15;     // of those, how many keep their subtitle text (localStorage is small)

const row = $("#continue");
const list = $("#continue-list");
const note = $("#resume-note");

const all = store.get(KEY, {});
let current = null;       // key of the video that's loaded
let lastSave = 0;

const recent = () => Object.values(all).sort((a, b) => b.updated - a.updated);
const dropSub = (key) => {
    try { localStorage.removeItem(SUB_PREFIX + key); localStorage.removeItem(SUB2_PREFIX + key); } catch { /* ignore */ }
};

function persist() {
    recent().forEach((r, i) => {
        if (i >= KEEP_SUBS) dropSub(r.key);
        if (i >= KEEP) delete all[r.key];
    });
    store.set(KEY, all);
}

// Merge fields into the current video's record (no-op when no video is loaded)
export function update(fields) {
    if (!current || !all[current]) return;
    Object.assign(all[current], fields, { updated: Date.now() });
    persist();
}

export function saveSub(sub) {
    if (!current || !sub) return;
    try { localStorage.setItem(SUB_PREFIX + current, JSON.stringify(sub)); } catch { /* storage full */ }
    update({ sub: sub.name });
}

// null removes it
export function saveSub2(sub) {
    if (!current) return;
    try {
        if (sub) localStorage.setItem(SUB2_PREFIX + current, JSON.stringify(sub));
        else localStorage.removeItem(SUB2_PREFIX + current);
    } catch { /* storage full */ }
    update({ sub2: sub ? sub.name : "", offset2: 0 });
}

function savedSub(key, prefix = SUB_PREFIX) {
    try { return JSON.parse(localStorage.getItem(prefix + key)); } catch { return null; }
}

function saveTime() {
    if (!current || state.recording || !isFinite(el.video.duration)) return;
    update({ time: el.video.currentTime, duration: el.video.duration });
    renderRow();
}

// A video was loaded: bring back its subs, delay and position, or start a new record.
// Returns the previous record (or null).
export function open(key, info) {
    current = key;
    const rec = all[key];
    all[key] = { key, time: 0, offset: 0, ...rec, ...info, updated: Date.now() };
    if (state.anime) all[key].anime = state.anime;
    else if (rec && rec.anime) state.anime = rec.anime;
    persist();

    const sub = rec && savedSub(key);
    if (sub && (!state.cues.length || state.subRestored)) {
        loadSubtitleText(sub.text, sub.ext, sub.name, { restoring: true });
        if (rec.offset) setOffset(rec.offset);
    } else if (state.subRaw && !state.subRestored) {
        saveSub(state.subRaw);          // subs were picked before the video
    }
    subs2.onVideoOpened(rec && savedSub(key, SUB2_PREFIX), rec ? rec.offset2 || 0 : 0);

    note.hidden = true;
    const resumeAt = rec ? rec.time : 0;
    if (resumeAt > 5) {
        el.video.addEventListener("loadedmetadata", () => {
            if (current !== key || resumeAt > el.video.duration - 15) return;
            el.video.currentTime = resumeAt;
            note.innerHTML = `⏯ resumed at ${timeFormatter(resumeAt)} <button>start over</button>`;
            note.hidden = false;
            note.querySelector("button").onclick = () => { el.video.currentTime = 0; note.hidden = true; };
            setTimeout(() => { note.hidden = true; }, 15000);
        }, { once: true });
    }
    renderRow();
    return rec || null;
}

// ---------- continue watching ----------

function renderRow() {
    const recs = recent().slice(0, 8);
    row.hidden = !recs.length;
    list.innerHTML = recs.map((r) => {
        const a = r.anime;
        const title = a ? (a.title.native || a.title.romaji) : r.videoName;
        const ep = episodeOf(r.videoName || "");
        const pct = r.duration ? Math.min(100, (r.time / r.duration) * 100) : 0;
        const when = pct > 90 ? "✓ finished" : timeFormatter(r.time) + (r.duration ? " / " + timeFormatter(r.duration) : "");
        return `<div class="resume-card${r.key === current ? " current" : ""}" data-key="${escapeHtml(r.key)}" title="${escapeHtml(r.videoName)}">
            ${a ? `<img src="${escapeHtml(a.coverImage.large)}" alt="">` : `<div class="noimg">▶</div>`}
            <div class="info">
                <b lang="ja">${escapeHtml(title)}</b>
                <span>${ep !== null ? `ep ${ep} · ` : ""}${when}</span>
                ${r.pct != null ? `<span class="pct ${pctLevel(r.pct)}" title="words you knew last time">${r.pct}% ${understood()}</span>` : ""}
                <div class="bar"><i style="width:${pct}%"></i></div>
            </div>
            <button class="forget" title="forget this">✕</button>
        </div>`;
    }).join("");
}

function onCardClick(e) {
    const card = e.target.closest(".resume-card");
    const rec = card && all[card.dataset.key];
    if (!rec) return;
    if (e.target.closest(".forget")) {
        delete all[rec.key];
        dropSub(rec.key);
        if (current === rec.key) current = null;
        persist();
        renderRow();
        return;
    }
    if (rec.anime) state.anime = rec.anime;
    document.getElementById("player-section").scrollIntoView({ behavior: "smooth" });
    reopen(rec);
}

export function init() {
    list.addEventListener("click", onCardClick);
    el.video.addEventListener("timeupdate", () => {
        if (Date.now() - lastSave < 5000) return;
        lastSave = Date.now();
        saveTime();
    });
    el.video.addEventListener("pause", saveTime);
    el.video.addEventListener("seeked", () => { if (el.video.paused) saveTime(); });
    window.addEventListener("pagehide", saveTime);
    renderRow();
}
