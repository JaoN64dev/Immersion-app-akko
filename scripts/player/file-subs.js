// Subtitles inside the video file (.mkv releases often carry Japanese and English ones): once a
// file is opened, its text subtitle tracks are listed here; pick one to use as the subtitles or
// as the 2nd subtitles. No website or API key needed. ffmpeg.wasm (player/dual-audio.js) copies
// the track out. If nothing is loaded yet, a track in the language you're learning is used
// straight away.

import { $ } from "../core/dom.js";
import { escapeHtml } from "../core/utils.js";
import { state } from "../core/state.js";
import { learningEnglish } from "../core/target.js";
import * as dualAudio from "./dual-audio.js";
import { loadSubtitleText } from "./cues.js";
import * as subs2 from "./subs2.js";

const ui = { bar: $("#filesub-bar"), select: $("#filesub-track"), main: $("#filesub-main"), second: $("#filesub-2nd"), status: $("#filesub-status") };

const LANGS = { jpn: "Japanese", ja: "Japanese", jap: "Japanese", eng: "English", en: "English", por: "Portuguese", pt: "Portuguese", spa: "Spanish", es: "Spanish" };
const isJapanese = (t) => /^(jpn|ja|jap)$/i.test(t.lang) || /japanese|日本語/i.test(t.title);
const isEnglish = (t) => /^(eng|en)$/i.test(t.lang) || /english/i.test(t.title);
const isWanted = (t) => (learningEnglish() ? isEnglish(t) : isJapanese(t));

let tracks = [];
const say = (text) => { ui.status.textContent = text; };
const label = (t) => [LANGS[t.lang.toLowerCase()] || t.lang, t.title, t.codec === "ass" || t.codec === "ssa" ? "styled" : "", t.isDefault && "(default)"]
    .filter(Boolean).join(" · ");

function show(list) {
    tracks = list.filter(dualAudio.isTextSubtitle);
    ui.bar.hidden = !tracks.length;
    say("");
    if (!tracks.length) return;
    ui.select.innerHTML = tracks.map((t, i) => `<option value="${i}">${escapeHtml(label(t))}</option>`).join("");
    // the full dialogue track, not a "Signs & Songs" one that only translates on-screen text
    const signsOnly = (t) => /signs?|songs?|forced/i.test(t.title);
    const wanted = [tracks.findIndex((t) => isWanted(t) && !signsOnly(t)), tracks.findIndex(isWanted)].find((i) => i >= 0) ?? -1;
    if (wanted >= 0) ui.select.value = String(wanted);
    // nothing loaded yet (no saved subtitles for this video): use the right language right away
    if (wanted >= 0 && !state.cues.length) use("main");
}

async function use(where) {
    const t = tracks[Number(ui.select.value)];
    if (!t) return;
    ui.main.disabled = ui.second.disabled = true;
    say("reading the subtitles from the file…");
    try {
        const { text, ext } = await dualAudio.extractSubtitle(t.n, t.codec);
        const name = `${label(t)} (from the video file)`;
        if (where === "main") loadSubtitleText(text, ext, name);
        else subs2.load(text, ext, name);
        say(where === "main" ? "✓ using them as the subtitles" : "✓ using them as the 2nd subtitles");
    } catch (err) {
        say("couldn't read them: " + err.message);
    } finally {
        ui.main.disabled = ui.second.disabled = false;
    }
}

export function init() {
    dualAudio.onSubtitleTracks(show);
    ui.main.addEventListener("click", () => use("main"));
    ui.second.addEventListener("click", () => use("second"));
}
