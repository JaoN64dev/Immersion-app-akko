// A magnet link or a .torrent in the Watch page: the server runs the torrent (server/torrent.js) and
// the player gets the episode as an ordinary link, /api/torrent/<hash>/<file>/<name> — so "continue
// watching", the progress, subtitles matching the episode and everything else work as for any link.
//
// A torrent with several episodes (a season "batch") goes into the episode bar of
// scripts/player/playlist.js, like a season of local files: ◀ the list ▶, "Next episode ⏭" when one
// ends, N, and "play the next one by itself". It opens on the episode watched last (or the one
// after, when that one was finished), and the next episode starts downloading near the end of this
// one, so it plays at once.
//
// The torrent bar says how the download goes and deletes the files; leaving the torrent (another
// video, or closing the page) stops the sharing.

import { $, el } from "../core/dom.js";
import { postJson, getJson, store, episodeOf } from "../core/utils.js";
import { t } from "../i18n.js";
import { KEY as PROGRESS_KEY } from "../progress.js";
import * as playlist from "./playlist.js";
import { pickEpisode } from "./torrent-episodes.js";

const ui = { bar: $("#torrent-bar"), status: $("#torrent-status"), del: $("#torrent-delete") };

const LINK = /^\/api\/torrent\/([a-f0-9]{40})\/(\d+)\//;
const PREFETCH_AT = 0.8;          // this far into an episode, the next one starts downloading
export const isMagnet = (s) => /^magnet:\?/i.test(String(s || "").trim());
export const hashOf = (url) => (LINK.exec(url || "") || [])[1] || null;
const indexOf = (url) => Number((LINK.exec(url || "") || [])[2]);
export const linkFor = (hash, f) => `/api/torrent/${hash}/${f.index}/${encodeURIComponent(f.name)}`;
// a link to a .torrent file, like nyaa's download button (…/download/123456.torrent)
export const isTorrentLink = (s) => /^https?:\/\/\S+(\.torrent(\?|#|$)|\/download\/\d+\/?$)/i.test(String(s || "").trim());
export const isTorrentFile = (f) => !!f && /\.torrent$/i.test(f.name);

let current = null;           // hash of the torrent playing
let files = [];               // its episodes, in watching order
let poll = null;
let prefetched = null;        // the link already asked for ahead of time
let open = () => {};          // video.js openUrl, given in init

const mb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`);
const say = (text) => { if (ui.status) ui.status.textContent = text; };

// watching order: the episode number in the name, then the name (the same as the episode bar)
const watchingOrder = (list) => [...list].sort((a, b) =>
    (episodeOf(a.name) ?? 1e9) - (episodeOf(b.name) ?? 1e9) || (a.path || a.name).localeCompare(b.path || b.name, undefined, { numeric: true }));

// the torrent's episodes as entries of the episode bar (each one opens its own link)
const entries = (hash) => files.map((f) => ({ name: f.name, index: f.index, open: () => open(linkFor(hash, f)) }));

async function refresh() {
    if (!current) return;
    try {
        const s = await getJson(`/api/torrent/${current}`);
        if (!s.running) { say(t("not sharing now")); return; }
        const playing = (s.files || []).find((f) => f.index === indexOf(el.video.currentSrc.replace(location.origin, "")));
        say(t("⇣ {down} · ⇡ {up} · {peers} peers · {pct}% of this episode here")
            .replace("{down}", mb(s.down)).replace("{up}", mb(s.up)).replace("{peers}", String(s.peers))
            .replace("{pct}", String(playing ? playing.progress : 0)));
    } catch { /* the server restarted: the next poll tries again */ }
}

function show(hash) {
    current = hash;
    if (!ui.bar) return;
    ui.bar.hidden = false;
    clearInterval(poll);
    poll = setInterval(refresh, 2000);
    refresh();
}

// The video is going away (another one opens, or the page closes): stop sharing this torrent,
// unless the next video is another episode of it
export function leaving(nextUrl = "") {
    if (!current || hashOf(nextUrl) === current) return;
    navigator.sendBeacon(`/api/torrent/${current}/stop`);
    if (playlist.tag() === current) playlist.set([]);
    current = null;
    files = [];
    clearInterval(poll);
    if (ui.bar) ui.bar.hidden = true;
}

// A torrent link is playing (opened here, from the episode bar, or from "continue watching"): show
// the bar, and for a batch make sure the episode bar holds this torrent's episodes
export async function attach(url) {
    const hash = hashOf(url);
    if (!hash) return;
    show(hash);
    if (!files.length) {
        try { const s = await getJson(`/api/torrent/${hash}`); if (s.files) files = watchingOrder(s.files); } catch { /* single episode then */ }
    }
    if (files.length > 1 && playlist.tag() !== hash) {
        const f = files.find((x) => x.index === indexOf(url));
        playlist.set(entries(hash), { tag: hash, start: f && f.name, play: false });
    }
}

// Ask the server for the torrent's episodes and open the right one. request() sends the magnet, the
// link or the file and resolves to the server's answer.
async function start(request) {
    if (ui.bar) ui.bar.hidden = false;
    say(t("asking the peers for the torrent's file list… (up to a minute and a half)"));
    try {
        const r = await request();
        files = watchingOrder(r.files);
        current = r.hash;
        const first = pickEpisode(Object.values(store.get(PROGRESS_KEY, {})), r.hash, files);
        if (files.length > 1) playlist.set(entries(r.hash), { tag: r.hash, start: first.name });
        else { playlist.set([]); open(linkFor(r.hash, first)); }
    } catch (err) {
        say(t("couldn't open the torrent: ") + err.message);
    }
}

// A magnet link, or a link to a .torrent, pasted in the link box
export const openLink = (link) => start(() => postJson("/api/torrent",
    isMagnet(link) ? { magnet: link.trim() } : { url: link.trim() }));
export const openMagnet = openLink;

// A .torrent file picked or dropped
export const openTorrentFile = (file) => start(async () => {
    const res = await fetch("/api/torrent", { method: "POST", headers: { "Content-Type": "application/x-bittorrent" }, body: file });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
    return body;
});

// Near the end of an episode, ask for the start of the next one: the server then fetches it while
// this one finishes, so "Next episode" plays at once
function prefetchNext() {
    if (!current || !(el.video.duration > 0) || el.video.currentTime / el.video.duration < PREFETCH_AT) return;
    const next = playlist.peekNext();
    if (!next || next.index === undefined || playlist.tag() !== current) return;
    const link = linkFor(current, next);
    if (prefetched === link) return;
    prefetched = link;
    fetch(link, { headers: { Range: "bytes=0-65535" } }).then((r) => r.body && r.body.cancel()).catch(() => {});
}

export function init({ openUrl }) {
    open = openUrl;
    if (!ui.bar) return;
    ui.del.addEventListener("click", async () => {
        if (!current || !confirm(t("stop this torrent and delete what it downloaded?"))) return;
        const hash = current;
        leaving();
        await fetch(`/api/torrent/${hash}`, { method: "DELETE" }).catch(() => {});
        say("");
    });
    el.video.addEventListener("timeupdate", prefetchNext);
    window.addEventListener("pagehide", () => leaving());
}
