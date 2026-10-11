// Several episodes at once: pick (or drag in) a whole season, and akko plays them in order.
// A bar under the player picks an episode; when one ends, "Next episode ⏭" shows over the video
// (N), or the next one starts by itself if that's ticked. Moving to another episode drops the
// last one's subtitles: the new one gets its own saved ones, the ones inside its file, or new ones.
//
// Dragging files onto the Watch page opens them too: videos (one, or several as a playlist) and
// subtitle files (.srt / .ass / .vtt: the subtitles; a second one at the same time: 2nd subtitles).

import { el, $ } from "../core/dom.js";
import { store, episodeOf } from "../core/utils.js";
import { toast } from "../core/toast.js";
import { openFile } from "./video.js";
import { clearSubs, loadSubtitleText } from "./cues.js";
import * as subs2 from "./subs2.js";

const SETTINGS = "akko-playlist";            // {auto}
const VIDEO = /\.(mkv|mp4|m4v|webm|mov|avi|ogv|ts)$/i;
const SUBS = /\.(srt|ass|ssa|vtt)$/i;

const ui = {
    bar: $("#playlist-bar"), prev: $("#playlist-prev"), list: $("#playlist-list"),
    next: $("#playlist-next"), auto: $("#playlist-auto"), button: null,
};

let files = [];
let at = -1;

// episode order: by the episode number in the name, then the name
const order = (a, b) => (episodeOf(a.name) ?? 1e9) - (episodeOf(b.name) ?? 1e9) || a.name.localeCompare(b.name, undefined, { numeric: true });

export function set(list) {
    files = list.filter((f) => VIDEO.test(f.name) || f.type.startsWith("video/")).sort(order);
    at = -1;
    ui.bar.hidden = files.length < 2;
    if (files.length) go(0);
}

function go(i) {
    if (i < 0 || i >= files.length) return;
    at = i;
    ui.button.hidden = true;
    // the last episode's subtitles aren't this one's
    clearSubs();
    subs2.clear({ save: false });
    openFile(files[i]);
    render();
}

function render() {
    ui.list.innerHTML = files.map((f, i) => {
        const ep = episodeOf(f.name);
        return `<option value="${i}">${ep !== null ? `ep ${ep} · ` : ""}${f.name.replace(/[<&>]/g, "")}</option>`;
    }).join("");
    ui.list.value = String(at);
    ui.prev.disabled = at <= 0;
    ui.next.disabled = at >= files.length - 1;
}

export function next() {
    if (!files.length) return;
    if (at < files.length - 1) go(at + 1);
    else toast("that was the last episode you opened");
}

function ended() {
    if (at < 0 || at >= files.length - 1) return;
    if (ui.auto.checked) {
        toast("next episode…");
        setTimeout(() => { if (el.video.ended) go(at + 1); }, 1500);
    } else {
        ui.button.hidden = false;
        ui.button.focus({ preventScroll: true });
    }
}

// ---------- dragging files in ----------

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

function readText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsText(file);
    });
}

async function dropped(list) {
    const videos = list.filter((f) => VIDEO.test(f.name) || f.type.startsWith("video/"));
    const subs = list.filter((f) => SUBS.test(f.name));
    if (!videos.length && !subs.length) { toast("drop video files (.mkv, .mp4…) or subtitles (.srt, .ass, .vtt)", true); return; }
    if (videos.length > 1) set(videos);
    else if (videos.length) { set([]); openFile(videos[0]); }
    // subtitles after the video, so they win over any saved for it
    for (const [i, f] of subs.slice(0, 2).entries()) {
        const ext = f.name.split(".").pop().toLowerCase();
        try {
            const text = await readText(f);
            if (i === 0) loadSubtitleText(text, ext, f.name);
            else subs2.load(text, ext, f.name);
        } catch (err) {
            toast(`couldn't read ${f.name}: ${err.message}`, true);
        }
    }
    document.getElementById("player-section")?.scrollIntoView({ behavior: "smooth" });
}

export function init() {
    ui.button = document.createElement("button");
    ui.button.type = "button";
    ui.button.className = "skip-btn next-btn";
    ui.button.hidden = true;
    ui.button.textContent = "Next episode ⏭";
    ui.button.title = "next episode (N)";
    ui.button.addEventListener("click", (e) => { e.stopPropagation(); next(); });
    el.video.parentElement.append(ui.button);

    ui.auto.checked = store.get(SETTINGS, {}).auto === true;
    ui.auto.addEventListener("input", () => store.set(SETTINGS, { auto: ui.auto.checked }));
    ui.prev.addEventListener("click", () => go(at - 1));
    ui.next.addEventListener("click", next);
    ui.list.addEventListener("input", () => go(Number(ui.list.value)));
    el.video.addEventListener("ended", ended);
    el.video.addEventListener("play", () => { ui.button.hidden = true; });
    el.video.addEventListener("emptied", () => { ui.button.hidden = true; });

    // drag and drop anywhere on the page
    let depth = 0;
    document.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; document.body.classList.add("dropping"); } });
    document.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; document.body.classList.remove("dropping"); } });
    document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        document.body.classList.remove("dropping");
        dropped([...e.dataTransfer.files]);
    });
}
