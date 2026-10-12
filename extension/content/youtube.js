// akko companion on YouTube: on a video with Japanese subtitles (made by people, or YouTube's
// automatic ones), puts akko's clickable subtitles over it (content/common.js), with a translation
// from the video's own subtitles or YouTube's translation. The subtitle files come from
// page/youtube.js, which catches them as YouTube's player downloads them.

(async () => {
    const A = window.akkoCompanion;
    await A.ready;

    const ASK = (type, extra = {}) => window.postMessage({ source: "akko-companion-ask", type, ...extra }, "*");
    const waiting = new Map();          // key -> {resolve, reject}
    let ov = null;
    let state = { videoId: null, title: "", tracks: [], languages: [], main: null };

    const player = () => document.getElementById("movie_player");
    const video = () => document.querySelector("#movie_player video.html5-main-video") || document.querySelector("#movie_player video");
    const videoIdNow = () => new URLSearchParams(location.search).get("v");

    // ---------- YouTube's own subtitles stay hidden while ours show ----------
    function hideNative(on) {
        let style = document.getElementById("akko-hide-captions");
        if (on && !style) {
            style = document.createElement("style");
            style.id = "akko-hide-captions";
            style.textContent = ".ytp-caption-window-container { display: none !important; }";
            document.documentElement.append(style);
        }
        if (!on && style) style.remove();
    }

    // ---------- the subtitle files (json3) ----------
    function parse(text) {
        let data;
        try { data = JSON.parse(text); } catch { return []; }
        const cues = [];
        for (const ev of data.events || []) {
            if (!ev.segs) continue;
            const line = ev.segs.map((s) => s.utf8 || "").join("").replace(/​/g, "").trim();
            if (!line) continue;
            const start = (ev.tStartMs || 0) / 1000;
            cues.push({ start, end: start + (ev.dDurationMs || 2500) / 1000, text: line });
        }
        cues.sort((a, b) => a.start - b.start);
        // automatic subtitles roll: each line ends when the next one starts
        for (let i = 0; i < cues.length - 1; i++) if (cues[i + 1].start > cues[i].start) cues[i].end = Math.min(cues[i].end, cues[i + 1].start);
        return cues;
    }

    function load(lang, kind = "", tlang = "") {
        const key = [state.videoId, lang, kind, tlang].join("|");
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { waiting.delete(key); reject(new Error("YouTube didn't send the subtitles (try playing the video, then reload)")); }, 15000);
            waiting.set(key, { resolve: (t) => { clearTimeout(timer); resolve(parse(t)); }, reject: (e) => { clearTimeout(timer); reject(e); } });
            ASK("load", { lang, kind, tlang });
        });
    }

    window.addEventListener("message", (e) => {
        if (e.source !== window || !e.data || e.data.source !== "akko-companion") return;
        const d = e.data;
        if (d.type === "tracks") onTracks(d);
        else if (d.type === "subs" && waiting.has(d.key)) { waiting.get(d.key).resolve(d.text); waiting.delete(d.key); }
        else if (d.type === "error" && waiting.has(d.key)) { waiting.get(d.key).reject(new Error(d.message)); waiting.delete(d.key); }
    });

    // ---------- a video ----------
    const idOf = (t) => `${t.lang}|${t.kind}`;
    const labelOf = (t) => `${t.name || t.lang}${t.kind === "asr" ? " (automatic)" : ""}`;

    function cleanup() {
        if (ov) { ov.destroy(); ov = null; }
        hideNative(false);
        state = { videoId: null, title: "", tracks: [], languages: [], main: null };
    }

    async function onTracks(d) {
        if (!d.videoId || d.videoId !== videoIdNow()) return;
        if (ov && state.videoId === d.videoId) return;
        cleanup();
        const ja = d.tracks.filter((t) => /^ja\b/i.test(t.lang));
        if (!ja.length) return;              // not a Japanese video: stay out of the way
        state = { videoId: d.videoId, title: d.title, tracks: d.tracks, languages: d.languages, main: null };
        const container = player();
        if (!container) return;
        ov = A.overlay(container, site);
        hideNative(true);
        // people's subtitles first, then YouTube's automatic ones
        const main = ja.find((t) => t.kind !== "asr") || ja[0];
        ov.setTracks(ja.map((t) => ({ id: idOf(t), label: labelOf(t) })), idOf(main));
        await useTrack(main);
        await useTranslation(defaultTranslation());
    }

    // the translation: subtitles in your language if the video has them, else YouTube's translation
    function translationChoices() {
        const own = state.tracks.filter((t) => !/^ja\b/i.test(t.lang) && t.kind !== "asr").map((t) => ({ id: `track:${idOf(t)}`, label: labelOf(t) }));
        const want = [A.prefs().translateTo, "en", "pt", "es", "fr", "de", "ko", "zh-Hans", "zh-Hant", "it", "ru", "id", "vi", "th"];
        const auto = state.main && state.main.translatable
            ? [...new Set(want)].map((code) => state.languages.find((l) => l.code === code)).filter(Boolean).map((l) => ({ id: `tl:${l.code}`, label: `${l.name} (YouTube's translation)` }))
            : [];
        return [...own, ...auto];
    }
    function defaultTranslation() {
        if (A.prefs().translation === "off") return "";
        const choices = translationChoices();
        const want = A.prefs().translateTo || "en";
        return (choices.find((c) => c.id.startsWith("track:") && c.id.slice(6).startsWith(want))
            || choices.find((c) => c.id === `tl:${want}`) || choices.find((c) => c.id === "tl:en") || choices[0] || { id: "" }).id;
    }

    async function useTrack(t) {
        state.main = t;
        ov.setTracks(state.tracks.filter((x) => /^ja\b/i.test(x.lang)).map((x) => ({ id: idOf(x), label: labelOf(x) })), idOf(t));
        try {
            const cues = await load(t.lang, t.kind);
            if (!ov || state.main !== t) return;
            await ov.setCues(cues, `${labelOf(t)}: ${cues.length} lines`);
            if (!cues.length) ov.toast("these subtitles are empty", true);
        } catch (err) {
            ov && ov.toast(err.message, true);
        }
    }

    async function useTranslation(id) {
        if (!ov) return;
        ov.setTranslations(translationChoices(), id);
        if (!id) { ov.setTranslation([]); return; }
        try {
            let cues;
            if (id.startsWith("track:")) {
                const [lang, kind] = id.slice(6).split("|");
                cues = await load(lang, kind || "");
            } else {
                cues = await load(state.main.lang, state.main.kind, id.slice(3));
            }
            if (ov) ov.setTranslation(cues);
        } catch (err) {
            ov && ov.toast(`translation: ${err.message}`, true);
        }
    }

    const site = {
        name: "youtube",
        video,
        recordable: true,
        screenshot: true,
        title: () => state.title,
        url: (t) => `https://www.youtube.com/watch?v=${state.videoId}&t=${Math.floor(t)}s`,
        onTrack: (id) => { const t = state.tracks.find((x) => idOf(x) === id); if (t) useTrack(t).then(() => useTranslation(defaultTranslation())); },
        onTranslation: (id) => useTranslation(id),
    };

    // ---------- YouTube is one page: watch for moving to another video ----------
    let lastId = null;
    function check() {
        const id = videoIdNow();
        if (!A.prefs().on.youtube || !location.pathname.startsWith("/watch")) {
            if (ov) cleanup();
            lastId = null;
            return;
        }
        if (id && (id !== lastId || !ov)) {
            if (id !== lastId) cleanup();
            lastId = id;
            ASK("tracks");
        }
    }
    document.addEventListener("yt-navigate-finish", () => setTimeout(check, 300));
    setInterval(check, 2000);
    check();
})();
