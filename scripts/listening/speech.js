// Saying Japanese lines out loud for the listening exercises. The ways to speak, best first:
//   - VOICEVOX: natural voices made by the server when VOICEVOX is open (server/speech.js)
//   - the browser's natural online voices (Edge's "Natural" ones, Chrome's Google voice)
//   - Windows' Japanese voices, made by the server
//   - any other Japanese voice the browser has
// Server-made lines play in an <audio> element, so they work in the desktop app's window (which
// has no voices of its own) and count as listening time (scripts/core/today.js).
// Questions with a recording play that file instead (playFile), in the same <audio> element.

import { getJson } from "../core/utils.js";

let options = [];               // [{id, name, server, voices: {woman, man, narrator}, credit}], best first
let current = null;             // the one in use
let browserVoices = [];
let playing = 0;                // bumps on stop(), so a sequence that's still going gives up
const audio = document.createElement("audio");
audio.hidden = true;
audio.preservesPitch = true;
document.body.append(audio);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function japaneseBrowserVoices() {
    if (!("speechSynthesis" in window)) return Promise.resolve([]);
    const now = () => speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
    if (now().length) return Promise.resolve(now());
    return new Promise((resolve) => {
        speechSynthesis.addEventListener("voiceschanged", () => resolve(now()), { once: true });
        setTimeout(() => resolve(now()), 1500);
    });
}

const isNatural = (v) => /natural|online|google/i.test(v.name);
const isMan = (v) => /ichiro|keita|naoki|daichi|otoya|hattori|male|男/i.test(v.name) && !/female/i.test(v.name);
const shortName = (v) => (v ? v.name.replace(/^(Microsoft|Google)\s+/, "").replace(/\s*[-(].*$/, "").replace(/\s+Online$/, "") : "");

// the browser's voices as one option: natural ones, or the rest
function browserOption(id, list, name) {
    const man = list.find(isMan);
    const women = list.filter((v) => !isMan(v));
    return {
        id, name, server: false, list,
        voices: { woman: shortName(women[0] || man), man: man ? shortName(man) : `${shortName(women[0])} (lower)`, narrator: shortName(women[1] || women[0] || man) },
        credit: "",
    };
}

// the ways akko can speak here, best first; preferred: an id to use if it's there ("auto": the best)
export async function init(preferred = "auto") {
    let server = [];
    try { server = (await getJson("/api/speech/voices")).engines || []; } catch { /* old server or offline */ }
    browserVoices = await japaneseBrowserVoices();
    const natural = browserVoices.filter(isNatural);
    const local = browserVoices.filter((v) => !isNatural(v));
    options = [
        ...server.filter((e) => e.id === "voicevox").map((e) => ({ ...e, server: true })),
        ...(natural.length ? [browserOption("browser-natural", natural, "this browser's natural voices")] : []),
        ...server.filter((e) => e.id !== "voicevox").map((e) => ({ ...e, server: true })),
        ...(local.length ? [browserOption("browser", local, "this browser's voices")] : []),
    ];
    choose(preferred);
    return { options, current };
}

// use this one ("auto" or one that isn't there: the best)
export function choose(id) {
    current = options.find((o) => o.id === id) || options[0] || null;
    return current;
}

export const available = () => !!current;

const lineUrl = (text, voice) => `/api/speech?${new URLSearchParams({ text, voice, engine: current.id })}`;

// ask the server for the lines ahead of time, so playing doesn't wait (one after another)
// (a newer call takes over: the older one stops, so moving on doesn't pile up requests)
let preparing = 0;
export async function prepare(lines) {
    if (!current?.server) return;
    const me = ++preparing;
    for (const { text, voice, url } of lines) {
        if (url) continue;
        if (me !== preparing) return;
        try { await fetch(lineUrl(text, voice)); } catch { return; }
    }
}

function browserVoice(voice) {
    const man = current.list.find(isMan);
    const women = current.list.filter((v) => !isMan(v));
    if (voice === "man") return { v: man || women[0], pitch: man ? 1 : 0.6 };
    if (voice === "narrator") return { v: women[1] || women[0], pitch: 1 };
    return { v: women[0] || man, pitch: 1 };
}

function sayInBrowser(text, voice, rate) {
    return new Promise((resolve, reject) => {
        const { v, pitch } = browserVoice(voice);
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "ja-JP";
        if (v) u.voice = v;
        u.pitch = pitch;
        u.rate = rate;
        u.onend = () => resolve();
        u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(e.error)));
        speechSynthesis.speak(u);
    });
}

function sayOnServer(text, voice, rate) {
    return new Promise((resolve, reject) => {
        audio.src = lineUrl(text, voice);
        audio.playbackRate = rate;
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("couldn't play the audio")); };
        const cleanup = () => {
            audio.removeEventListener("ended", done);
            audio.removeEventListener("error", failed);
            audio.removeEventListener("pause", stopped);
        };
        // stop() pauses it: carry on as if it ended (the sequence checks whether it was stopped)
        const stopped = () => { if (!audio.ended) done(); };
        audio.addEventListener("ended", done);
        audio.addEventListener("error", failed);
        audio.addEventListener("pause", stopped);
        audio.play().catch(failed);
    });
}

// play a recording, or the part of it from start to end (seconds); resolves when it's done
export function playFile(url, { start, end } = {}, rate = 1) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            audio.removeEventListener("ended", done);
            audio.removeEventListener("error", failed);
            audio.removeEventListener("pause", stopped);
            audio.removeEventListener("timeupdate", tick);
        };
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("couldn't play the recording")); };
        const stopped = () => { if (!audio.ended) done(); };
        const tick = () => { if (end !== undefined && audio.currentTime >= end) audio.pause(); };
        audio.src = url;
        audio.playbackRate = rate;
        if (start) audio.currentTime = start;
        audio.addEventListener("ended", done);
        audio.addEventListener("error", failed);
        audio.addEventListener("pause", stopped);
        audio.addEventListener("timeupdate", tick);
        audio.play().catch(failed);
    });
}

// say one line; voice = "woman" | "man" | "narrator"
export function say(text, voice = "woman", rate = 1) {
    if (!current) return Promise.reject(new Error("no Japanese voice"));
    return current.server ? sayOnServer(text, voice, rate) : sayInBrowser(text, voice, rate);
}

// say lines one after another: [{text, voice | url, start, end, pause (ms before it), onStart}]. Resolves true when
// all were said, false if stop() came first.
export async function sequence(lines, rate = 1) {
    stop();
    const me = playing;
    for (const line of lines) {
        if (line.pause) await wait(line.pause / rate);
        if (me !== playing) return false;
        line.onStart?.();
        if (line.url) await playFile(line.url, line, rate);
        else await say(line.text, line.voice, rate);
        if (me !== playing) return false;
    }
    return true;
}

export function stop() {
    playing++;
    if (!audio.paused) audio.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
}
