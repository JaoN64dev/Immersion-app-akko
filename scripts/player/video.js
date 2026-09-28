// Getting a video into the player: a local file or a pasted link

import { el } from "../core/dom.js";
import { state } from "../core/state.js";
import { loadScript, timeFormatter } from "../core/utils.js";
import { renderFiles } from "../subtitles/browser.js";
import * as dualAudio from "./dual-audio.js";
import * as progress from "../progress.js";
import { setPresence, tickPresence } from "../core/presence.js";

const HLS_JS = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js";
let hls = null;

function resetVideo() {
    if (hls) { hls.destroy(); hls = null; }
    if (el.video.src.startsWith("blob:")) URL.revokeObjectURL(el.video.src);
    el.video.removeAttribute("src");
    dualAudio.reset();
}

function openFile(file) {
    resetVideo();
    el.video.src = URL.createObjectURL(file);
    state.videoName = file.name;
    const saved = progress.open(`file:${file.name}:${file.size}`, { videoName: file.name });
    videoLoaded();
    dualAudio.load(file, saved && saved.audioTrack);
}

async function openUrl(url) {
    resetVideo();
    state.videoName = decodeURIComponent(url.split("/").pop().split("?")[0]);
    if (/\.m3u8(\?|$)/i.test(url) && !el.video.canPlayType("application/vnd.apple.mpegurl")) {
        await loadScript(HLS_JS);
        hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(el.video);
    } else {
        el.video.src = url;
    }
    progress.open(`url:${url}`, { videoName: state.videoName, url });
    videoLoaded();
}

function videoLoaded() {
    el.stageEmpty.hidden = true;
    updateNowPlaying();
    renderFiles();              // re-highlight subs matching this episode
}

export function updateNowPlaying() {
    const parts = [];
    if (state.videoName) parts.push("▶ " + state.videoName);
    if (state.subName) parts.push(`字幕: ${state.subName} (${state.cues.length} lines)`);
    el.nowPlaying.textContent = parts.join("   ·   ");
    updatePresence(el.video.paused);
}

// What to show on Discord: the show title if one was picked from AniList, else the file name;
// the episode file and playback position underneath.
function updatePresence(paused, throttled = false) {
    const title = (state.anime && (state.anime.title.native || state.anime.title.romaji)) || state.videoName;
    if (!title) return;
    const time = isFinite(el.video.duration) ? `${timeFormatter(el.video.currentTime)} / ${timeFormatter(el.video.duration)}` : timeFormatter(el.video.currentTime);
    const line = state.anime ? `${state.videoName} — ${time}` : time;
    const payload = { type: 3, details: title, state: (paused ? "⏸ " : "▶ ") + line };
    (throttled ? tickPresence : setPresence)(payload);
}

// For "continue watching": reopen a link, or ask for the local file again
export function reopen(rec) {
    if (rec.url) {
        el.videoUrl.value = rec.url;
        openUrl(rec.url);
    } else {
        // browsers can't reopen a local file by themselves, so ask for it
        el.nowPlaying.textContent = `pick “${rec.videoName}” to continue`;
        el.videoFile.value = "";
        el.videoFile.click();
    }
}

export function init() {
    el.videoFile.addEventListener("change", () => {
        const file = el.videoFile.files[0];
        if (file) openFile(file);
    });
    el.urlForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const url = el.videoUrl.value.trim();
        if (url) openUrl(url);
    });
    el.video.addEventListener("error", () => {
        el.nowPlaying.textContent = "this video can't be played by the browser (try an .mp4 / .webm, or an .mkv with h264 video)";
    });
    el.video.addEventListener("play", () => updatePresence(false));
    el.video.addEventListener("pause", () => updatePresence(true));
    el.video.addEventListener("timeupdate", () => updatePresence(el.video.paused, true));
}
