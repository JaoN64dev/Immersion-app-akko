// Shadowing (3.0, feature 10) on the Watch page: R or replays the current line while recording
// its sound, then records you saying it, and draws both melodies on top of each other with a
// "melody match" (scripts/core/prosody.js). Both recordings can be played back. Nothing is saved or
// sent anywhere: it all happens in this page.

import { $, el } from "../core/dom.js";
import { state } from "../core/state.js";
import { toast } from "../core/toast.js";
import { t } from "../i18n.js";
import { cueIndexAt, cueStart, cueEnd } from "./cues.js";
import * as dualAudio from "./dual-audio.js";
import { pitchTrack, semitones, compare } from "../core/prosody.js";

const RATE = 16000;
const ui = {
    panel: $("#shadow-panel"), status: $("#shadow-status"), canvas: $("#shadow-canvas"), score: $("#shadow-score"),
    original: $("#shadow-play-original"), yours: $("#shadow-play-yours"), again: $("#shadow-again"), close: $("#shadow-close"),
    button: $("#shadow-line"),
};

let busy = false;
let clips = { original: null, yours: null };     // blob URLs, for playing back
let lastCue = null;
let last = null;                   // the last comparison, for checking it (lastShadow())
export const lastShadow = () => last;

const say = (text) => { ui.status.textContent = text; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function recorderFor(stream) {
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType })); });
    return { rec, done };
}

// The line as it plays: from a little before it starts to a little after it ends
async function recordLine(cue) {
    const from = dualAudio.isActive() ? dualAudio.audio : el.video;
    const capture = from.captureStream || from.mozCaptureStream;
    if (!capture) throw new Error(t("this browser can't record the video's sound"));
    const start = Math.max(0, cueStart(cue) - 0.1), end = cueEnd(cue) + 0.15;
    el.video.currentTime = start;
    await new Promise((r) => el.video.addEventListener("seeked", r, { once: true }));
    await el.video.play();
    const stream = capture.call(from);
    if (!stream.getAudioTracks().length) await Promise.race([new Promise((r) => stream.addEventListener("addtrack", r, { once: true })), sleep(1000)]);
    const tracks = stream.getAudioTracks();
    if (!tracks.length) { el.video.pause(); throw new Error(t("the video has no sound to record")); }
    const { rec, done } = recorderFor(new MediaStream(tracks));
    rec.start();
    const deadline = performance.now() + (end - start + 3) * 1000;
    while (el.video.currentTime < end && !el.video.paused && !el.video.ended && performance.now() < deadline) await sleep(30);
    el.video.pause();
    rec.stop();
    return done;
}

// You, for as long as the line plus a second
async function recordYou(seconds) {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .catch(() => { throw new Error(t("akko can't use the microphone: allow it for this page and try again")); });
    try {
        const { rec, done } = recorderFor(mic);
        rec.start();
        for (let left = Math.ceil(seconds); left > 0; left--) {
            say(t("your turn: say the line ({n})").replace("{n}", String(left)));
            await sleep(Math.min(1000, (seconds - (Math.ceil(seconds) - left)) * 1000));
        }
        rec.stop();
        return await done;
    } finally {
        mic.getTracks().forEach((tr) => tr.stop());
    }
}

async function samplesOf(blob) {
    const ctx = new OfflineAudioContext(1, 1, RATE);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
        const d = audio.getChannelData(c);
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels;
    }
    return { samples: mono, rate: audio.sampleRate };
}

// Both melodies, each across the whole width (so a faster or slower line still lines up by eye)
// leading and trailing silence off, so the two melodies line up by eye
const trim = (line) => { const first = line.findIndex((v) => v !== null); if (first < 0) return []; let last = line.length - 1; while (line[last] === null) last--; return line.slice(first, last + 1); };

function draw(a, b) {
    a = trim(a); b = trim(b);
    const c = ui.canvas, g = c.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const colors = [css.getPropertyValue("--highlight").trim() || "#c33", css.getPropertyValue("--ink-soft").trim() || "#777"];
    g.clearRect(0, 0, c.width, c.height);
    const all = [...a, ...b].filter((v) => v !== null);
    const lo = Math.min(-3, ...all), hi = Math.max(3, ...all);
    const y = (v) => c.height - 10 - ((v - lo) / (hi - lo)) * (c.height - 20);
    g.lineWidth = 3;
    g.lineCap = "round";
    [a, b].forEach((line, k) => {
        g.strokeStyle = colors[k];
        g.setLineDash(k ? [6, 5] : []);
        g.beginPath();
        let drawing = false;
        line.forEach((v, i) => {
            const x = 6 + (i / Math.max(1, line.length - 1)) * (c.width - 12);
            if (v === null) { drawing = false; return; }
            if (drawing) g.lineTo(x, y(v)); else g.moveTo(x, y(v));
            drawing = true;
        });
        g.stroke();
    });
    g.setLineDash([]);
}

function setClip(which, blob) {
    if (clips[which]) URL.revokeObjectURL(clips[which]);
    clips[which] = URL.createObjectURL(blob);
}

export async function shadowLine(again = false) {
    if (busy) return;
    const cue = again && lastCue ? lastCue : state.cues[cueIndexAt(el.video.currentTime)];
    if (!cue) { toast(t("load subtitles and go to a line first: shadowing follows the line's timing"), true); return; }
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) { toast(t("this browser can't record"), true); return; }
    busy = true;
    lastCue = cue;
    ui.panel.hidden = false;
    ui.score.textContent = "";
    ui.original.disabled = ui.yours.disabled = ui.again.disabled = true;
    state.recording = true;            // "continue watching" doesn't save the jumps around the line
    try {
        say(t("listen…"));
        const originalBlob = await recordLine(cue);
        const seconds = cueEnd(cue) - cueStart(cue) + 1;
        const yoursBlob = await recordYou(seconds);
        say(t("comparing…"));
        setClip("original", originalBlob);
        setClip("yours", yoursBlob);
        const [o, y] = await Promise.all([samplesOf(originalBlob), samplesOf(yoursBlob)]);
        const to = pitchTrack(o.samples, o.rate), ty = pitchTrack(y.samples, y.rate);
        const result = compare(to, ty);
        last = { original: to, yours: ty, result, rates: [o.rate, y.rate], seconds: [o.samples.length / o.rate, y.samples.length / y.rate] };
        // yours: only the stretch that was compared (not an "eh" before or a word after)
        const mine = semitones(ty);
        draw(semitones(to), result.match ? mine.slice(result.match.from, result.match.to + 1) : mine);
        say("");
        ui.score.textContent = result.score === null
            ? t(result.reason)
            : t("melody match: {n}%").replace("{n}", String(result.score));
        ui.score.className = result.score === null ? "shadow-score" : "shadow-score comp-badge inline " + (result.score >= 75 ? "high" : result.score >= 50 ? "mid" : "low");
    } catch (err) {
        say(err.message);
    } finally {
        state.recording = false;
        busy = false;
        ui.original.disabled = !clips.original;
        ui.yours.disabled = !clips.yours;
        ui.again.disabled = false;
    }
}

export function init() {
    if (!ui.panel) return;
    ui.button.addEventListener("click", () => shadowLine());
    ui.again.addEventListener("click", () => shadowLine(true));
    ui.original.addEventListener("click", () => clips.original && new Audio(clips.original).play());
    ui.yours.addEventListener("click", () => clips.yours && new Audio(clips.yours).play());
    ui.close.addEventListener("click", () => { ui.panel.hidden = true; });
}
