// akko companion on Netflix (EXPERIMENTAL): on a title with Japanese subtitles, akko's clickable
// subtitles go over the video, with a translation from another subtitle track. The track list
// comes from page/netflix.js; the subtitle files (WebVTT) are downloaded by background.js.
// Netflix's video is copy-protected, so a card's line audio and picture are taken from the tab.

(async () => {
    const A = window.akkoCompanion;
    await A.ready;

    let ov = null;
    const byMovie = new Map();         // movieId -> the subtitle tracks Netflix listed for it
    let latest = { at: 0, tracks: [] }; // the last list, for when Netflix's id differs from the address
    let watchSince = 0;                // when the current /watch page was opened
    let tracks = [];                   // the title being watched
    let state = { movieId: null, main: null, translation: "" };

    const video = () => document.querySelector(".watch-video video, video");
    const movieIdNow = () => (location.pathname.match(/^\/watch\/(\d+)/) || [])[1] || null;

    function hideNative(on) {
        let style = document.getElementById("akko-hide-captions");
        if (on && !style) {
            style = document.createElement("style");
            style.id = "akko-hide-captions";
            style.textContent = ".player-timedtext { display: none !important; }";
            document.documentElement.append(style);
        }
        if (!on && style) style.remove();
    }

    // WebVTT -> [{start, end, text}]
    const seconds = (t) => t.split(":").reverse().reduce((sum, part, i) => sum + parseFloat(part) * 60 ** i, 0);
    function parseVtt(text) {
        const cues = [];
        for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
            const lines = block.split("\n");
            const at = lines.findIndex((l) => l.includes("-->"));
            if (at < 0) continue;
            const [a, b] = lines[at].split("-->").map((s) => s.trim().split(/\s+/)[0]);
            const line = lines.slice(at + 1).join("\n")
                .replace(/<[^>]+>/g, "").replace(/&lrm;|&rlm;|‎|‏/g, "")
                .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
            if (line) cues.push({ start: seconds(a), end: seconds(b), text: line });
        }
        return cues.sort((x, y) => x.start - y.start);
    }

    // TTML (XML): the other subtitle format, for titles without WebVTT; ruby readings are left out
    function parseTtml(text) {
        const doc = new DOMParser().parseFromString(text, "application/xml");
        const root = doc.documentElement;
        const tickRate = Number(root.getAttribute("ttp:tickRate") || root.getAttributeNS("http://www.w3.org/ns/ttml#parameter", "tickRate")) || 10000000;
        const time = (v) => (!v ? 0 : /t$/.test(v) ? parseInt(v, 10) / tickRate : /s$/.test(v) ? parseFloat(v) : seconds(v));
        const textOf = (node) => [...node.childNodes].map((n) => {
            if (n.nodeType === 3) return n.nodeValue;
            if (n.localName === "br") return "\n";
            if (/text/.test(n.getAttribute && (n.getAttribute("tts:ruby") || ""))) return "";   // the reading above the kanji
            return textOf(n);
        }).join("");
        const cues = [];
        for (const p of doc.getElementsByTagNameNS("*", "p")) {
            const line = textOf(p).replace(/[ \t]+/g, " ").trim();
            if (line) cues.push({ start: time(p.getAttribute("begin")), end: time(p.getAttribute("end")), text: line });
        }
        return cues.sort((x, y) => x.start - y.start);
    }

    const loadTrack = async (t) => {
        if (t.cues) return t.cues;              // a file caught from Netflix's player
        const { text } = await A.ask({ type: "text", url: t.url });
        return t.format === "ttml" || /^\s*</.test(text) ? parseTtml(text) : parseVtt(text);
    };
    const isJa = (t) => /^ja\b/i.test(t.lang);

    function cleanup() {
        if (ov) { ov.destroy(); ov = null; }
        hideNative(false);
        state = { movieId: null, main: null, translation: "" };
    }

    async function useTrack(t) {
        state.main = t;
        ov.setTracks(tracks.filter(isJa).map((x) => ({ id: x.url, label: x.label })), t.url);
        try {
            const cues = await loadTrack(t);
            if (ov && state.main === t) await ov.setCues(cues, `${t.label}: ${cues.length} lines`);
        } catch (err) { ov && ov.toast(err.message, true); }
    }

    async function useTranslation(url) {
        const others = tracks.filter((t) => !isJa(t)).map((t) => ({ id: t.url, label: t.label }));
        state.translation = url;
        ov.setTranslations(others, url);
        if (!url) { ov.setTranslation([]); return; }
        try { ov.setTranslation(await loadTrack(tracks.find((t) => t.url === url))); } catch (err) { ov && ov.toast(`translation: ${err.message}`, true); }
    }

    let starting = false;
    async function start() {
        const id = movieIdNow();
        if (!id) { watchSince = 0; if (ov) cleanup(); return; }
        if (!watchSince) watchSince = Date.now();
        const v = video();
        if (!A.prefs().on.netflix || !v) { if (ov) cleanup(); return; }
        if (ov && state.movieId === id) return;
        if (starting) return;
        tracks = byMovie.get(id) || (latest.at >= watchSince - 5000 ? latest.tracks : []);
        if (!tracks.filter(isJa).length && caughtFor(id).some(isJa)) tracks = caughtFor(id);
        if (!tracks.length) {
            window.postMessage({ source: "akko-companion-ask", type: "nf-tracks", movieId: id }, "*");
            hint("no subtitle list from Netflix yet: turn on Japanese subtitles in Netflix's subtitle menu");
            return;
        }
        const ja = tracks.filter(isJa);
        if (!ja.length) { hint(`this title's subtitles: ${tracks.map((t) => t.lang).join(", ") || "none"}; no Japanese`); return; }
        starting = true;
        try { await begin(id, v, ja); } finally { starting = false; }
    }
    async function begin(id, v, ja) {
        cleanup();
        state.movieId = id;
        const container = v.closest(".watch-video") || v.parentElement;
        ov = A.overlay(container, site);
        hideNative(true);
        await useTrack(ja.find((t) => !/\[CC\]/.test(t.label)) || ja[0]);
        const want = A.prefs().translateTo || "en";
        const tr = A.prefs().translation === "off" ? null
            : tracks.find((t) => !isJa(t) && t.lang.startsWith(want)) || tracks.find((t) => !isJa(t) && t.lang.startsWith("en")) || tracks.find((t) => !isJa(t) && t.cues);
        await useTranslation(tr ? tr.url : "");
    }

    // ---------- the backup way: subtitle files caught as Netflix's player downloads them ----------
    const caughtByMovie = new Map();       // movieId -> [{lang, label, url: "caught:<lang>", cues}]
    const caughtFor = (id) => caughtByMovie.get(id) || [];
    let lastHint = "";
    const hint = (text) => { if (text !== lastHint) { lastHint = text; console.info(`[akko companion] ${text}`); } };

    function onFile(text) {
        const id = movieIdNow();
        if (!id) return;
        const xml = /^\s*</.test(text);
        const cues = xml ? parseTtml(text) : parseVtt(text);
        if (!cues.length) return;
        // which language: the file says so (TTML), or there's kana in it
        const declared = xml ? (text.match(/xml:lang="([^"]+)"/) || [])[1] : "";
        const sample = cues.slice(0, 40).map((c) => c.text).join("");
        const lang = /[぀-ヿ]/.test(sample) ? "ja" : declared && !/^ja\b/i.test(declared) ? declared : "other";
        const t = { lang, label: `${lang === "ja" ? "Japanese" : lang} (from Netflix's player)`, url: `caught:${lang}`, cues };
        const list = caughtFor(id).filter((x) => x.url !== t.url);
        caughtByMovie.set(id, [...list, t]);
        hint(`caught ${lang} subtitles (${cues.length} lines)`);
        if (!ov) { start(); return; }
        if (state.movieId !== id || !tracks.some((x) => x.cues)) return;     // the overlay uses Netflix's list
        tracks = caughtFor(id);
        if (isJa(t)) useTrack(t);
        else if (!state.translation) useTranslation(t.url);
    }

    window.addEventListener("message", (e) => {
        if (e.source === window && e.data && e.data.source === "akko-companion" && e.data.type === "nf-file") onFile(e.data.text);
        if (e.source !== window || !e.data || e.data.source !== "akko-companion" || e.data.type !== "nf-tracks") return;
        const list = e.data.tracks || [];
        byMovie.set(String(e.data.movieId || ""), list);
        latest = { at: Date.now(), tracks: list };
        start();
    });

    const site = {
        name: "netflix",
        video,
        recordable: "tab",                 // copy-protected: the line's audio and the picture come from the
        screenshot: "tab",                 // whole tab (background.js, offscreen.js), not the video
        seek: (t) => window.postMessage({ source: "akko-companion-ask", type: "nf-seek", time: t }, "*"),
        title: () => (document.querySelector("[data-uia='video-title']")?.textContent || document.title.replace(/\s*-?\s*Netflix\s*$/i, "")).trim(),
        url: (t) => `https://www.netflix.com/watch/${state.movieId}?t=${Math.floor(t)}`,
        onTrack: (url) => { const t = tracks.find((x) => x.url === url); if (t) useTrack(t); },
        onTranslation: (url) => useTranslation(url),
    };

    setInterval(start, 2000);
})();
