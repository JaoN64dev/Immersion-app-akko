// 観る Watch page (index.html): anime + Japanese subtitles.
// Modules only define things when imported; their init() wires the page, run here in order.

import { el } from "../core/dom.js";
import { state } from "../core/state.js";
import { store, timeFormatter } from "../core/utils.js";
import * as settings from "../player/settings.js";
import * as search from "../search.js";
import * as subtitles from "../subtitles/browser.js";
import * as opensubs from "../subtitles/opensubs.js";
import * as video from "../player/video.js";
import * as dualAudio from "../player/dual-audio.js";
import * as fullscreen from "../player/fullscreen.js";
import * as cues from "../player/cues.js";
import * as subs2 from "../player/subs2.js";
import * as fileSubs from "../player/file-subs.js";
import * as render from "../player/render.js";
import * as popup from "../popup.js";
import * as mining from "../mining.js";
import * as ankiPanel from "../anki/panel.js";
import * as progress from "../progress.js";
import { watchHover } from "../words/hover.js";
import { initKeys } from "../keys.js";
import { remindBackup } from "../core/reminder.js";

for (const mod of [settings, search, subtitles, opensubs, video, dualAudio, fileSubs, fullscreen, cues, subs2, render, popup, ankiPanel, progress]) {
    mod.init();
}

// ---------- words in the subtitles ----------

// What a clicked line is: the sentence, and where it's from (for mined cards)
function cueContext(cue) {
    return {
        sentence: cue ? cue.text.replace(/\n/g, " ") : undefined,
        info: {
            source: [state.anime && (state.anime.title.native || state.anime.title.romaji), state.videoName].filter(Boolean).join(" — "),
            time: timeFormatter(el.video.currentTime),
            videoName: state.videoName,
            cueStart: cue ? cues.cueStart(cue) : null,
            cueEnd: cue ? cues.cueEnd(cue) : null,
            translation: cue ? subs2.textFor(cues.cueStart(cue), cues.cueEnd(cue)) : "",
        },
    };
}
popup.enableWordClicks(el.overlay, ".line", (line) => cueContext(state.cues[Number(line.dataset.cue)]));
popup.enableWordClicks(el.transcript, "li", (li) => cueContext(state.cues[[...el.transcript.children].indexOf(li)]));
watchHover(el.overlay, el.transcript);

// Anki can grab a screenshot + the line's audio when the card's video is the one loaded
function mediaFor(info) {
    if (!info.videoName || info.videoName !== state.videoName || !el.video.currentSrc) return null;
    return { player: el.video, audioFrom: dualAudio.isActive() ? dualAudio.audio : el.video, screenshot: true };
}

// hovering a subtitle line pauses the video; moving off it resumes
let hoverPaused = false;
const overLine = () => !!el.overlay.querySelector(".line:hover");
el.overlay.addEventListener("mouseover", (e) => {
    if (!el.hoverPause.checked || el.video.paused || state.recording || !e.target.closest(".line")) return;
    hoverPaused = true;
    el.video.pause();
});
el.overlay.addEventListener("mouseout", (e) => {
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".line");
    if (!hoverPaused || to || popup.isOpen()) return;
    hoverPaused = false;
    if (!state.recording) el.video.play();
});
el.video.addEventListener("play", () => { hoverPaused = false; });   // e.g. space while hovering

// looking a word up pauses the video; closing the popup resumes it (or leaves it to the
// hover pause if the mouse is still on the line)
popup.setPopupHooks({
    onOpen: () => {
        const wasPlaying = !el.video.paused || hoverPaused;
        hoverPaused = false;
        el.video.pause();
        return wasPlaying;
    },
    onClose: (wasPlaying) => {
        if (!wasPlaying || el.autoPause.checked || state.recording) return;
        if (el.hoverPause.checked && overLine()) hoverPaused = true;
        else el.video.play();
    },
    media: mediaFor,
});
mining.initList({ media: mediaFor });

// ---------- keys ----------

initKeys({
    " ": (e) => {
        if (e.target === el.video) return;     // the video's own controls handle it
        e.preventDefault();
        el.video.paused ? el.video.play() : el.video.pause();
    },
    a: cues.prevLine,
    s: cues.replayLine,
    d: cues.nextLine,
    h: settings.toggleHideSubs,
    t: subs2.cycleMode,
    f: fullscreen.toggleFullscreen,
    "[": () => cues.nudgeOffset(-0.1),
    "]": () => cues.nudgeOffset(0.1),
});

// collapsible panels that remember being open (e.g. the player's "字幕 settings")
for (const d of document.querySelectorAll("details[data-remember]")) {
    d.open = store.get(d.dataset.remember, false);
    d.addEventListener("toggle", () => store.set(d.dataset.remember, d.open));
}

// the transcript can be closed so the video gets the whole width
const playerLayout = document.querySelector(".player-layout");
const transcriptToggle = document.getElementById("transcript-toggle");
function showTranscript(show) {
    playerLayout.classList.toggle("no-transcript", !show);
    transcriptToggle.setAttribute("aria-pressed", String(show));
    store.set("akko-transcript-shown", show);
    const cur = show && el.transcript.children[state.activeIdx];
    if (cur) el.transcript.scrollTop = cur.offsetTop - el.transcript.clientHeight / 3;
}
transcriptToggle.addEventListener("click", () => showTranscript(playerLayout.classList.contains("no-transcript")));
document.getElementById("transcript-close").addEventListener("click", () => showTranscript(false));
showTranscript(store.get("akko-transcript-shown", true));

remindBackup();
