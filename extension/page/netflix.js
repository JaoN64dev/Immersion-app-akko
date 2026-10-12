// akko companion, inside Netflix's own page (the "MAIN world"). EXPERIMENTAL: Netflix changes its
// player now and then, and this may need fixing when it does.
//   - Netflix only sends the subtitle formats its player asks for: WebVTT (plain text) is added to
//     that request, and the subtitle tracks are read from Netflix's answer (both pass through
//     JSON.stringify / JSON.parse or Response.json, which is where they're caught)
//   - the answers are kept per title: hover previews on the browse page load other titles too, and
//     the list for the title being watched may arrive before content/netflix.js is listening
//   - jumping to a line: setting the video's time directly breaks Netflix's player, so it goes
//     through Netflix's own player controls
// Messages: to content/netflix.js   {source: "akko-companion", type: "nf-tracks", movieId, tracks: [{lang, label, url, format}]}
//           from content/netflix.js {source: "akko-companion-ask", type: "nf-tracks", movieId}  (answered with the above)
//           from content/netflix.js {source: "akko-companion-ask", type: "nf-seek", time}
//           to content/netflix.js   {source: "akko-companion", type: "nf-file", url, text}  (a subtitle file the player downloaded)

(() => {
    const TAG = "akko-companion";
    const WEBVTT = "webvtt-lssdh-ios8";
    const TEXT_PROFILES = [WEBVTT, "dfxp-ls-sdh", "simplesdh"];     // in order of preference; the rest are TTML (XML)
    const byMovie = new Map();       // movieId -> tracks

    // objects in a value, two levels down (Netflix's request shape changes between versions)
    const near = (value) => {
        const out = [];
        if (!value || typeof value !== "object") return out;
        out.push(value);
        for (const v of Object.values(value)) {
            if (v && typeof v === "object" && !Array.isArray(v)) {
                out.push(v);
                for (const w of Object.values(v)) if (w && typeof w === "object" && !Array.isArray(w)) out.push(w);
            }
        }
        return out;
    };

    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...rest) {
        try {
            for (const o of near(value)) {
                if (!Array.isArray(o.profiles)) continue;
                const isManifest = "showAllSubDubTracks" in o || o.profiles.some((p) => /dfxp|imsc|simplesdh|nflx-cmisc|webvtt/i.test(String(p)));
                if (!isManifest) continue;
                for (const p of TEXT_PROFILES) if (!o.profiles.includes(p)) o.profiles.push(p);
                if ("showAllSubDubTracks" in o) o.showAllSubDubTracks = true;
            }
        } catch { /* not ours to break */ }
        return stringify.call(this, value, ...rest);
    };

    const urlOf = (d) => {
        if (!d) return null;
        const urls = d.urls || d.downloadUrls;
        if (!urls) return typeof d.url === "string" ? d.url : null;
        const first = Array.isArray(urls) ? urls[0] : Object.values(urls)[0];
        return typeof first === "string" ? first : first && first.url;
    };
    const download = (t) => {
        const d = t.ttDownloadables || {};
        for (const p of TEXT_PROFILES) { const url = urlOf(d[p]); if (url) return { url, format: p === WEBVTT ? "vtt" : "ttml" }; }
        for (const [p, v] of Object.entries(d)) {
            if (/cmisc|image/i.test(p)) continue;            // pictures of text: nothing to read
            const url = urlOf(v);
            if (url) return { url, format: /webvtt/i.test(p) ? "vtt" : "ttml" };
        }
        return null;
    };

    function look(value) {
        try {
            for (const o of near(value)) {
                if (!Array.isArray(o.timedtexttracks) || !o.timedtexttracks.length) continue;
                const movieId = String(o.movieId || o.viewableId || "");
                const tracks = o.timedtexttracks.filter((t) => !t.isNoneTrack && !t.isForcedNarrative).map((t) => {
                    const dl = download(t);
                    return dl && {
                        lang: t.language || t.bcp47 || "",
                        label: `${t.languageDescription || t.language}${t.trackType === "ASSISTIVE" || t.rawTrackType === "closedcaptions" ? " [CC]" : ""}`,
                        ...dl,
                    };
                }).filter(Boolean);
                byMovie.set(movieId, tracks);
                console.info(`[akko companion] Netflix listed ${tracks.length} subtitle tracks for ${movieId}: ${tracks.map((t) => t.lang).join(", ")}`);
                window.postMessage({ source: TAG, type: "nf-tracks", movieId, tracks }, "*");
            }
        } catch { /* not ours to break */ }
    }

    const parse = JSON.parse;
    JSON.parse = function (text, ...rest) {
        const value = parse.call(this, text, ...rest);
        if (typeof text === "string" && text.includes("timedtexttracks")) look(value);
        return value;
    };
    const json = Response.prototype.json;
    Response.prototype.json = function () {
        return json.call(this).then((value) => { look(value); return value; });
    };

    // the backup way: the subtitle files Netflix's own player downloads (when its subtitles are on)
    const FILES = /nflxvideo\.net\//;
    const head = (buf) => new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(64, buf.byteLength))).replace(/^﻿/, "");
    const isSubs = (start) => /^\s*(WEBVTT|<\?xml|<tt[\s>])/.test(start);
    function caught(url, body) {
        try {
            let text = "";
            if (typeof body === "string") text = isSubs(body.slice(0, 64)) ? body : "";
            else if (body instanceof ArrayBuffer && body.byteLength < 5e6 && isSubs(head(body))) text = new TextDecoder().decode(body);
            if (!text) return;
            console.info("[akko companion] caught a subtitle file from Netflix's player");
            window.postMessage({ source: TAG, type: "nf-file", url, text }, "*");
        } catch { /* not ours to break */ }
    }
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__akkoUrl = String(url);
        return open.call(this, method, url, ...rest);
    };
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
        if (FILES.test(this.__akkoUrl || "")) {
            this.addEventListener("load", () => {
                try {
                    const r = this.responseType === "" || this.responseType === "text" ? this.responseText : this.response;
                    caught(this.__akkoUrl, r);
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
            const size = Number(res.headers.get("content-length") || 0);
            if (url && FILES.test(url) && (!size || size < 5e6)) res.clone().arrayBuffer().then((b) => caught(url, b), () => {});
        } catch { /* not ours to break */ }
        return res;
    };

    window.addEventListener("message", (e) => {
        if (e.source !== window || !e.data || e.data.source !== `${TAG}-ask`) return;
        if (e.data.type === "nf-tracks") {
            const movieId = String(e.data.movieId || "");
            if (byMovie.has(movieId)) window.postMessage({ source: TAG, type: "nf-tracks", movieId, tracks: byMovie.get(movieId) }, "*");
        }
        if (e.data.type === "nf-seek") {
            try {
                const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
                const ids = vp.getAllPlayerSessionIds();
                vp.getVideoPlayerBySessionId(ids[ids.length - 1]).seek(Math.round(e.data.time * 1000));
            } catch { /* the player isn't there (yet) */ }
        }
    });
})();
