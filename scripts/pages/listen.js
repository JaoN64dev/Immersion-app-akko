// 聴く Listen page (podcasts.html): Japanese podcasts with transcripts

import * as popup from "../popup.js";
import { initKeys } from "../keys.js";
import { remindBackup } from "../core/reminder.js";
import * as directory from "../podcasts/directory.js";
import * as player from "../podcasts/player.js";
import { learningEnglish } from "../core/target.js";

if (learningEnglish()) document.getElementById("pod-query").placeholder = "search English podcasts…";

popup.init();
directory.init();
player.init({ onProgressChange: directory.refreshEpisodes });

// looking a word up pauses the episode; closing the popup resumes it.
// (No Anki audio: podcast files come from other sites, which browsers won't let us record.)
popup.setPopupHooks({
    onOpen: () => { const wasPlaying = !player.audio.paused; player.audio.pause(); return wasPlaying; },
    onClose: (wasPlaying) => { if (wasPlaying && !document.getElementById("pod-autopause").checked) player.audio.play().catch(() => {}); },
});

const playing = () => player.current().episode;
initKeys({
    " ": (e) => {
        if (!playing() || e.target === player.audio) return;
        e.preventDefault();
        player.togglePlay();
    },
    a: player.prevLine,
    s: player.replayLine,
    d: player.nextLine,
    arrowleft: () => playing() && player.skip(-10),
    arrowright: () => playing() && player.skip(10),
});

remindBackup();
