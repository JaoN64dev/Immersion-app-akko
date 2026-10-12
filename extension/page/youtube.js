// akko companion, inside YouTube's own page (the "MAIN world"): YouTube only hands out a video's
// subtitles to its own player (the request carries a token only the player has), so this listens
// in on the player's subtitle downloads and passes them to content/youtube.js. To get a track, it
// asks the player to switch to it; YouTube's own subtitles are hidden by content/youtube.js.
//
// Messages (window.postMessage):
//   from content/youtube.js {source: "akko-companion-ask", type: "tracks"}            -> tracks
//   from content/youtube.js {source: "akko-companion-ask", type: "load", lang, kind, tlang}
//   to   content/youtube.js {source: "akko-companion", type: "tracks", videoId, title, tracks, languages}
//   to   content/youtube.js {source: "akko-companion", type: "subs", key, text}

(() => {
    const TAG = "akko-companion";
    const got = new Map();          // "videoId|lang|kind|tlang" -> the subtitle file (json3)
    const signed = new Map();       // videoId -> a subtitle address that worked (it carries the player's token)

    const keyOf = (url) => {
        const u = new URL(url, location.href);
        return [u.searchParams.get("v"), u.searchParams.get("lang"), u.searchParams.get("kind") || "", u.searchParams.get("tlang") || ""].join("|");
    };
    const keep = (url, text) => {
        if (!/\/api\/timedtext/.test(url) || !text) return;
        const key = keyOf(url);
        got.set(key, text);
        window.postMessage({ source: TAG, type: "subs", key, text }, "*");
    };

    // the player downloads subtitles with XMLHttpRequest (or fetch, in some versions)
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__akkoUrl = String(url);
        return open.call(this, method, url, ...rest);
    };
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
        if (/\/api\/timedtext/.test(this.__akkoUrl || "")) {
            this.addEventListener("load", () => {
                try {
                    const text = this.responseType === "" || this.responseType === "text" ? this.responseText
                        : this.responseType === "json" ? JSON.stringify(this.response) : "";
                    keep(this.__akkoUrl, text);
                } catch { /* not ours to break */ }
            });
        }
        return send.apply(this, args);
    };
    const realFetch = window.fetch;
    window.fetch = async function (input, init) {
        const res = await realFetch.call(this, input, init);
        try {
            const url = typeof input === "string" ? input : input && input.url;
            if (url && /\/api\/timedtext/.test(url)) res.clone().text().then((t) => keep(url, t), () => {});
        } catch { /* not ours to break */ }
        return res;
    };

    const player = () => document.getElementById("movie_player");
    const nameOf = (n) => (n ? n.simpleText || (n.runs || []).map((r) => r.text).join("") : "");

    window.addEventListener("message", (e) => {
        if (e.source !== window || !e.data || e.data.source !== `${TAG}-ask`) return;
        const p = player();
        if (!p || !p.getPlayerResponse) return;
        const resp = p.getPlayerResponse() || {};
        const videoId = resp.videoDetails && resp.videoDetails.videoId;
        const list = (resp.captions && resp.captions.playerCaptionsTracklistRenderer) || {};

        if (e.data.type === "tracks") {
            window.postMessage({
                source: TAG, type: "tracks", videoId,
                title: (resp.videoDetails && resp.videoDetails.title) || document.title.replace(/ - YouTube$/, ""),
                tracks: (list.captionTracks || []).map((t) => ({ lang: t.languageCode, kind: t.kind || "", name: nameOf(t.name), translatable: !!t.isTranslatable })),
                languages: (list.translationLanguages || []).map((l) => ({ code: l.languageCode, name: nameOf(l.languageName) })),
            }, "*");
        }

        if (e.data.type === "load") {
            const { lang, kind = "", tlang = "" } = e.data;
            const key = [videoId, lang, kind, tlang].join("|");
            if (got.has(key)) {
                window.postMessage({ source: TAG, type: "subs", key, text: got.get(key) }, "*");
                return;
            }
            // once the player has a token for this video, any of its tracks can be asked for directly
            const base = signed.get(videoId);
            if (base) {
                const u = new URL(base, location.href);
                u.searchParams.set("lang", lang);
                if (kind) u.searchParams.set("kind", kind); else u.searchParams.delete("kind");
                if (tlang) u.searchParams.set("tlang", tlang); else u.searchParams.delete("tlang");
                u.searchParams.set("fmt", "json3");
                realFetch(u.href, { credentials: "include" }).then((r) => r.text()).then((t) => {
                    if (t) keep(u.href, t); else pick(p, lang, kind, tlang, key);
                }, () => pick(p, lang, kind, tlang, key));
                return;
            }
            pick(p, lang, kind, tlang, key);
        }
    });

    // switch the player to the track; it then downloads it (and keep() catches it)
    function pick(p, lang, kind, tlang, key, tries = 0) {
        try {
            if (p.loadModule) p.loadModule("captions");
            // the player's own track object, so automatic ("asr") tracks are picked right
            const tracklist = (p.getOption && p.getOption("captions", "tracklist")) || [];
            const track = tracklist.find((t) => t.languageCode === lang && (t.kind || "") === kind) || { languageCode: lang, kind };
            p.setOption("captions", "track", tlang ? { ...track, translationLanguage: { languageCode: tlang } } : track);
        } catch (err) {
            window.postMessage({ source: TAG, type: "error", key, message: String(err && err.message || err) }, "*");
            return;
        }
        // the first download can come back empty; switching off and on again makes the player retry
        if (tries < 3) setTimeout(() => {
            if (got.has(key)) return;
            try { p.setOption("captions", "track", {}); } catch { /* fine */ }
            setTimeout(() => pick(p, lang, kind, tlang, key, tries + 1), 300);
        }, 3500);
    }
})();
