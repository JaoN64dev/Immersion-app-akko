// ⏭ Skip intro / skip ending on the Watch page.
//   1. AniSkip (api.aniskip.com, free, made by its users): the exact opening and ending of an anime
//      episode, found by the show (the one picked in the AniList search, or found from the file
//      name) and the episode number in the file name.
//   2. Your own: press I when an opening starts and again when it ends; akko remembers it for that
//      show and offers the skip near the same time in its other episodes.
//   3. Nothing known: K jumps 85 seconds (most openings are about 1:30).
// K also presses the skip button when it shows. "skip openings by itself" in the player settings
// skips them without asking (only exact times from AniSkip, and only once: going back plays it).
//
// Saved: "akko-skip-cache" {"mal:episode": {at, segments}}, "akko-intros" {show: {start, length,
// title}}, "akko-skip" {auto}.

import { el, $ } from "../core/dom.js";
import { state } from "../core/state.js";
import { store, getJson, episodeOf, titleFromFile, seasonFromFile, timeFormatter } from "../core/utils.js";
import { toast } from "../core/toast.js";
import { learningEnglish } from "../core/target.js";

const CACHE = "akko-skip-cache";
const MINE = "akko-intros";
const SETTINGS = "akko-skip";
const JUMP = 85;
const KEEP_FOUND = 30 * 86400e3, KEEP_MISSING = 86400e3;
const MY_WINDOW = 60;            // your intro: the button shows this long before/after where it was

const ui = { button: null, status: $("#skip-status"), auto: $("#auto-skip") };

let segments = [];               // exact ones: [{type: "op" | "ed", start, end}]
let mine = null;                 // your intro for this show: {start, length}
let show = null;                 // {key, title, mal}
let episode = null;
let marking = null;              // I pressed once: when the intro started
let autoSkipped = new Set();     // segments skipped by themselves in this playback
let job = 0;

// ---------- which show is this? ----------

const squash = (s) => String(s || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");

// does the file's title look like this AniList entry?
function sameShow(anime, fileTitle) {
    const f = squash(fileTitle);
    if (f.length < 3) return true;
    const names = [anime.title?.romaji, anime.title?.english, anime.title?.native, ...(anime.synonyms || [])].map(squash).filter(Boolean);
    return names.some((n) => n.includes(f) || f.includes(n));
}

const ANILIST = "https://graphql.anilist.co";
const anilist = (query, variables) => getJson(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
});

const found = new Map();         // file title -> AniList entry (this session)
async function searchAnime(title) {
    if (!found.has(title)) {
        found.set(title, anilist(`query ($q: String) { Media(search: $q, type: ANIME) { id idMal title { romaji english native } synonyms } }`, { q: title })
            .then((r) => r.data.Media).catch(() => null));
    }
    return found.get(title);
}

async function malOf(anime) {
    if (anime.idMal) return anime.idMal;
    try { return (await anilist(`query ($id: Int) { Media(id: $id) { idMal } }`, { id: anime.id })).data.Media.idMal; } catch { return null; }
}

// the show: the one picked in the search if the file looks like it, else found from the file name
async function findShow(fileTitle) {
    const picked = state.anime;
    if (picked && sameShow(picked, fileTitle)) {
        return { key: `anilist:${picked.id}`, title: picked.title.native || picked.title.romaji, mal: await malOf(picked) };
    }
    if (fileTitle.length >= 2) {
        // a later season is its own entry on AniList: "Shingeki no Kyojin Season 3"
        const season = seasonFromFile(state.videoName);
        const m = await searchAnime(season > 1 ? `${fileTitle} Season ${season}` : fileTitle);
        if (m) return { key: `anilist:${m.id}`, title: m.title.native || m.title.romaji || fileTitle, mal: m.idMal };
        return { key: `file:${squash(fileTitle)}`, title: fileTitle, mal: null };
    }
    return state.videoName ? { key: `file:${squash(state.videoName)}`, title: state.videoName, mal: null } : null;
}

// ---------- AniSkip ----------

async function aniskip(mal, ep, length) {
    const key = `${mal}:${ep}`;
    const cache = store.get(CACHE, {});
    const hit = cache[key];
    if (hit && Date.now() - hit.at < (hit.segments.length ? KEEP_FOUND : KEEP_MISSING)) return hit.segments;
    const types = ["op", "ed", "mixed-op", "mixed-ed"].map((t) => `types=${t}`).join("&");
    let list = [];
    try {
        const res = await fetch(`https://api.aniskip.com/v2/skip-times/${mal}/${ep}?${types}&episodeLength=${Math.round(length || 0)}`);
        const data = await res.json();
        list = (data.found ? data.results : []).map((r) => ({
            type: r.skipType.endsWith("ed") ? "ed" : "op",
            start: r.interval.startTime,
            end: r.interval.endTime,
            // the times are for a release of this length; another release can be a bit off
            length: r.episodeLength,
        }));
    } catch {
        return [];               // offline: try again next time
    }
    // keep the cache small: the newest 300 episodes
    cache[key] = { at: Date.now(), segments: list };
    const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
    for (const k of keys.slice(300)) delete cache[k];
    store.set(CACHE, cache);
    return list;
}

// ---------- when a video is opened ----------

async function prepare() {
    const myJob = ++job;
    segments = [];
    mine = null;
    show = null;
    marking = null;
    autoSkipped = new Set();
    renderStatus("looking for this episode's opening…");
    if (!state.videoName) return renderStatus("");
    const fileTitle = titleFromFile(state.videoName);
    episode = episodeOf(state.videoName);
    const s = await findShow(fileTitle).catch(() => null);
    if (myJob !== job) return;
    show = s;
    mine = show ? store.get(MINE, {})[show.key] || null : null;
    // AniSkip is for anime (by MyAnimeList id)
    if (show?.mal && episode && !learningEnglish()) {
        const list = await aniskip(show.mal, episode, el.video.duration);
        if (myJob !== job) return;
        segments = list;
    }
    renderStatus();
    update();
}

// ---------- the button ----------

// what can be skipped right now: {label, to, segment?}
function current() {
    const t = el.video.currentTime;
    const seg = segments.find((s) => t >= s.start - 0.5 && t < s.end - 1);
    if (seg) return { label: seg.type === "ed" ? "Skip ending" : "Skip intro", to: seg.end, seg };
    // your own intro, when there's no exact one: near where it was, skip its length from now
    if (mine && !segments.some((s) => s.type === "op") && Math.abs(t - mine.start) <= MY_WINDOW) {
        return { label: `Skip intro (${timeFormatter(mine.length)})`, to: t + mine.length };
    }
    return null;
}

function update() {
    if (!ui.button) return;
    const c = el.video.currentSrc && !el.video.ended ? current() : null;
    ui.button.hidden = !c;
    if (!c) return;
    // only when it changes (the 日本語 interface translates it each time it's set)
    if (ui.button.dataset.label !== c.label) {
        ui.button.dataset.label = c.label;
        ui.button.textContent = `${c.label} ⏭`;
    }
    // skip by itself: exact openings (and endings) only, once each
    if (c.seg && ui.auto.checked && !autoSkipped.has(c.seg)) {
        autoSkipped.add(c.seg);
        jump(c.to, `skipped the ${c.seg.type === "ed" ? "ending" : "opening"}`);
    }
}

function jump(to, message) {
    const end = isFinite(el.video.duration) ? el.video.duration - 0.5 : Infinity;
    el.video.currentTime = Math.min(to, end);
    if (message) toast(`⏭ ${message}`);
}

function skip() {
    const c = current();
    if (c) {
        if (c.seg) autoSkipped.add(c.seg);
        jump(c.to);
    }
}

// K: the skip button if it's there, else 85 seconds ahead
export function skipKey() {
    if (!el.video.currentSrc) return;
    if (current()) skip();
    else jump(el.video.currentTime + JUMP, `+${JUMP} s (press I at the start and end of an opening to remember it for this show)`);
}

// I: mark where the opening starts, then where it ends
export function markKey() {
    if (!el.video.currentSrc || !show) return;
    const t = el.video.currentTime;
    if (marking === null) {
        marking = t;
        toast(`intro starts at ${timeFormatter(t)}: press I again when it ends`);
        return;
    }
    const length = t - marking;
    const start = marking;
    marking = null;
    if (length < 15 || length > 240) {
        toast("that doesn't look like an opening (15 s to 4 min): press I at its start to try again", true);
        return;
    }
    const all = store.get(MINE, {});
    all[show.key] = { start, length, title: show.title };
    store.set(MINE, all);
    mine = all[show.key];
    toast(`saved: the intro of ${show.title} is ${timeFormatter(length)}. The skip button shows near it in its other episodes`);
    renderStatus();
}

function forgetMine() {
    if (!show) return;
    const all = store.get(MINE, {});
    delete all[show.key];
    store.set(MINE, all);
    mine = null;
    renderStatus();
    update();
}

// ---------- the line in the player settings ----------

function renderStatus(text) {
    if (!ui.status) return;
    if (text !== undefined) { ui.status.textContent = text; return; }
    const kinds = [...new Set(segments.map((s) => (s.type === "ed" ? "ending" : "opening")))];
    const what = show ? `${show.title}${episode ? ` #${episode}` : ""}` : "";
    if (kinds.length) ui.status.textContent = `skip times for ${what}: ${kinds.join(" and ")} (AniSkip)`;
    else if (mine) {
        ui.status.innerHTML = "";
        ui.status.append(`your intro for ${show.title}: ${timeFormatter(mine.length)} near ${timeFormatter(mine.start)} `);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "linklike";
        b.textContent = "forget it";
        b.addEventListener("click", forgetMine);
        ui.status.append(b);
    } else if (state.videoName) {
        ui.status.textContent = `no skip times for ${what || "this video"}: press I when the opening starts and again when it ends, and akko remembers it for this show`;
    } else ui.status.textContent = "";
}

export function init() {
    ui.button = document.createElement("button");
    ui.button.type = "button";
    ui.button.className = "skip-btn";
    ui.button.hidden = true;
    ui.button.title = "skip (K)";
    ui.button.addEventListener("click", (e) => { e.stopPropagation(); skip(); });
    el.video.parentElement.append(ui.button);

    ui.auto.checked = store.get(SETTINGS, {}).auto === true;
    ui.auto.addEventListener("input", () => store.set(SETTINGS, { ...store.get(SETTINGS, {}), auto: ui.auto.checked }));

    el.video.addEventListener("loadedmetadata", prepare);
    el.video.addEventListener("timeupdate", update);
    el.video.addEventListener("seeked", update);
    el.video.addEventListener("emptied", () => { ui.button.hidden = true; });
}
