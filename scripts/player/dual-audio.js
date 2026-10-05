// Dual-audio files. Browsers can't switch audio tracks, so ffmpeg.wasm copies the chosen
// track out of the file. It plays in a hidden <audio> kept in sync with the video,
// and the video's own sound is turned down to zero.
// The same look at the file also finds the subtitle tracks inside it: player/file-subs.js
// lists them, and extractSubtitle() copies one out.

import { $, el } from "../core/dom.js";
import { escapeHtml } from "../core/utils.js";
import * as progress from "../progress.js";
import { learningEnglish } from "../core/target.js";

const FF = "/node_modules/@ffmpeg";

// codecs we can copy as-is into something the browser plays; anything else is re-encoded to aac
const COPY = {
    aac: ["m4a", "audio/mp4"], opus: ["webm", "audio/webm"], vorbis: ["webm", "audio/webm"],
    flac: ["flac", "audio/flac"], mp3: ["mp3", "audio/mpeg"],
};
const LANGS = { jpn: "🇯🇵 Japanese", ja: "🇯🇵 Japanese", eng: "English", en: "English", und: "unknown language" };
const isJapanese = (t) => /^(jpn|ja|jap)$/i.test(t.lang) || /japanese|日本語/i.test(t.title);
const isEnglish = (t) => /^(eng|en)$/i.test(t.lang) || /english|英語/i.test(t.title);
// the track in the language you're learning
const isWanted = (t) => (learningEnglish() ? isEnglish(t) : isJapanese(t));

const ui = { bar: $("#audio-bar"), select: $("#audio-track"), status: $("#audio-status") };

// the extracted track plays here (Anki records from it too)
export const audio = new Audio();

let ffmpeg = null;
let busy = false;
let file = null;
let tracks = [];
let job = 0;               // bumps on every new file so stale work is ignored
let active = false;        // true while the extracted track is playing
let gain = null;
const extracted = new Map();   // track number -> blob url

export const isActive = () => active;
const say = (text) => { ui.status.textContent = text; };

// ---------- ffmpeg ----------

async function getFFmpeg() {
    if (ffmpeg) return ffmpeg;
    const { FFmpeg } = await import(`${FF}/ffmpeg/dist/esm/index.js`);
    const f = new FFmpeg();
    await f.load({
        coreURL: `${FF}/core/dist/esm/ffmpeg-core.js`,
        wasmURL: `${FF}/core/dist/esm/ffmpeg-core.wasm`,
    });
    await f.createDir("/in");
    ffmpeg = f;
    return f;
}

// Run ffmpeg and collect its log lines
async function run(args, onProgress) {
    const f = await getFFmpeg();
    const lines = [];
    const onLog = ({ message }) => lines.push(message);
    const onProg = ({ progress: p }) => onProgress && p >= 0 && p <= 1 && onProgress(p);
    f.on("log", onLog);
    f.on("progress", onProg);
    busy = true;
    try {
        const code = await f.exec(args);
        return { code, lines };
    } finally {
        busy = false;
        f.off("log", onLog);
        f.off("progress", onProg);
    }
}

// "Stream #0:1[0x2](jpn): Audio: aac (LC), 48000 Hz, stereo, fltp (default)" + following "title : ..." lines
// kind: "Audio" or "Subtitle"; n counts only that kind (ffmpeg's 0:a:n / 0:s:n)
export function parseStreams(lines, kind = "Audio") {
    const out = [];
    let cur = null;
    for (const line of lines) {
        const m = line.match(/Stream #\d+:\d+(?:\[\w+\])?(?:\((\w+)\))?: (\w+): (\w+)(.*)/);
        if (m) {
            cur = m[2] === kind
                ? { n: out.length, lang: m[1] || "und", codec: m[3], title: "", isDefault: /\(default\)/.test(m[4]) }
                : null;
            if (cur) out.push(cur);
            continue;
        }
        const t = cur && line.match(/^\s+title\s*:\s*(.*)$/);
        if (t) cur.title = t[1].trim();
    }
    return out;
}

// ---------- subtitle tracks in the file ----------

// text subtitles ffmpeg can turn into .srt / keep as .ass; picture ones (PGS, DVD) can't be read as text
const TEXT_SUBS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);
export const isTextSubtitle = (t) => TEXT_SUBS.has(t.codec);

const subListeners = [];
// fn(tracks) is called when a file's subtitle tracks are known ([] when a new video starts)
export const onSubtitleTracks = (fn) => subListeners.push(fn);
const tellSubs = (subs) => subListeners.forEach((fn) => { try { fn(subs); } catch (err) { console.warn(err); } });

// Copy subtitle track n out of the open file -> {text, ext}
export async function extractSubtitle(n, codec) {
    if (!file) throw new Error("no video file is open");
    if (busy) throw new Error("still working on an audio track, try again in a moment");
    const keepAss = codec === "ass" || codec === "ssa";
    const out = `/sub${n}.${keepAss ? "ass" : "srt"}`;
    const { code } = await run(["-hide_banner", "-i", `/in/${file.name}`, "-map", `0:s:${n}`, "-c:s", keepAss ? "copy" : "srt", out]);
    if (code !== 0) throw new Error("ffmpeg couldn't read that subtitle track");
    const data = await ffmpeg.readFile(out);
    await ffmpeg.deleteFile(out);
    return { text: new TextDecoder().decode(data), ext: keepAss ? "ass" : "srt" };
}

function label(t) {
    return [LANGS[t.lang] || t.lang, t.codec, t.title, t.isDefault && "(default)"].filter(Boolean).join(" · ");
}

// ---------- choosing a track ----------

// A local file was opened: list its audio tracks and pick Japanese (or English) if needed
export async function load(f, preferred) {
    const myJob = job;
    file = f;
    try {
        const ff = await getFFmpeg();
        if (myJob !== job) return;
        await ff.mount("WORKERFS", { files: [f] }, "/in");
        const { lines } = await run(["-hide_banner", "-i", `/in/${f.name}`]);   // exits with an error, but prints the streams
        if (myJob !== job) return;
        tracks = parseStreams(lines);
        tellSubs(parseStreams(lines, "Subtitle"));
    } catch (err) {
        console.warn("audio probe failed", err);
        return;
    }
    if (tracks.length < 2) return;

    ui.select.innerHTML = `<option value="orig">file's own audio (as the browser plays it)</option>`
        + tracks.map((t) => `<option value="${t.n}">${escapeHtml(label(t))}</option>`).join("");
    ui.bar.hidden = false;

    // Last time's choice for this file wins. Otherwise: the browser plays the first track,
    // so if that isn't Japanese (English) but another one is, switch automatically.
    const jp = tracks.find(isWanted);
    if (preferred === "orig" || (typeof preferred === "number" && tracks[preferred])) {
        ui.select.value = String(preferred);
        choose(preferred);
    } else if (jp && !isWanted(tracks[0])) {
        ui.select.value = String(jp.n);
        choose(jp.n);
    } else {
        ui.select.value = "orig";
        const name = learningEnglish() ? "English" : "Japanese";
        say(jp ? `${name} is already the main track ✓` : `no track is marked ${name}, pick one to try`);
    }
}

async function choose(n) {
    if (n === "orig") { useOriginal(); say(""); return; }
    const t = tracks[n];
    const myJob = job;
    try {
        if (!extracted.has(n)) {
            if (busy) { say("still working on the other track…"); return; }
            const [ext, mime] = COPY[t.codec] || ["m4a", "audio/mp4"];
            const out = `/track${n}.${ext}`;
            const codecArgs = COPY[t.codec] ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"];
            say(`extracting ${LANGS[t.lang] || t.lang} audio… 0%`);
            const { code } = await run(
                ["-hide_banner", "-i", `/in/${file.name}`, "-map", `0:a:${n}`, "-vn", "-sn", "-dn", ...codecArgs, out],
                (p) => myJob === job && say(`extracting ${LANGS[t.lang] || t.lang} audio… ${Math.round(p * 100)}%`));
            if (myJob !== job) return;
            if (code !== 0) throw new Error("ffmpeg couldn't extract that track");
            const data = await ffmpeg.readFile(out);
            await ffmpeg.deleteFile(out);
            extracted.set(n, URL.createObjectURL(new Blob([data.buffer], { type: mime })));
        }
        if (myJob !== job || ui.select.value !== String(n)) return;
        useTrack(extracted.get(n));
        say(`✓ playing ${label(t)}`);
    } catch (err) {
        if (myJob === job) say("couldn't switch audio: " + err.message);
    }
}

// ---------- playing it ----------

// Route the video's own sound through a gain node so we can silence it
function silenceVideo(on) {
    if (!gain) {
        if (!on) return;
        const ctx = new AudioContext();
        gain = ctx.createGain();
        ctx.createMediaElementSource(el.video).connect(gain).connect(ctx.destination);
    }
    gain.gain.value = on ? 0 : 1;
    gain.context.resume();
}

function useTrack(url) {
    audio.src = url;
    audio.currentTime = el.video.currentTime;
    audio.volume = el.video.volume;
    audio.muted = el.video.muted;
    audio.playbackRate = el.video.playbackRate;
    active = true;
    silenceVideo(true);
    if (!el.video.paused) audio.play().catch(() => {});
}

function useOriginal() {
    active = false;
    audio.pause();
    audio.removeAttribute("src");
    silenceVideo(false);
}

// A different video is being loaded: drop everything, stop any extraction
export function reset() {
    job++;
    tellSubs([]);
    if (busy && ffmpeg) { ffmpeg.terminate(); ffmpeg = null; busy = false; }
    if (ffmpeg && file) ffmpeg.unmount("/in").catch(() => {});
    useOriginal();
    extracted.forEach((url) => URL.revokeObjectURL(url));
    extracted.clear();
    tracks = [];
    file = null;
    ui.bar.hidden = true;
    say("");
}

export function init() {
    ui.select.addEventListener("change", () => {
        const n = ui.select.value === "orig" ? "orig" : Number(ui.select.value);
        progress.update({ audioTrack: n });
        choose(n);
    });

    // keep the audio glued to the video
    const v = el.video;
    const playAudio = () => { if (active) audio.play().catch(() => {}); };
    v.addEventListener("play", playAudio);
    v.addEventListener("playing", playAudio);
    v.addEventListener("pause", () => audio.pause());
    v.addEventListener("waiting", () => audio.pause());
    v.addEventListener("seeking", () => { if (active) audio.currentTime = v.currentTime; });
    v.addEventListener("ratechange", () => { audio.playbackRate = v.playbackRate; });
    v.addEventListener("volumechange", () => { audio.volume = v.volume; audio.muted = v.muted; });
    setInterval(() => {
        if (active && !v.paused && Math.abs(audio.currentTime - v.currentTime) > 0.12) audio.currentTime = v.currentTime;
    }, 400);
}
