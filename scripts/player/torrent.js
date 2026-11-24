// A magnet link in the "paste a link" box: the server runs the torrent (server/torrent.js) and the
// player gets the episode as an ordinary link, /api/torrent/<hash>/<file>/<name> — so "continue
// watching", the progress, subtitles matching the episode and everything else work as for any link.
// The bar under the source buttons picks the episode, says how the download goes, and deletes the
// files; leaving the episode (another video, or closing the page) stops the sharing.

import { $ } from "../core/dom.js";
import { escapeHtml, postJson, getJson } from "../core/utils.js";
import { t } from "../i18n.js";

const ui = {
    bar: $("#torrent-bar"), file: $("#torrent-file"), status: $("#torrent-status"), del: $("#torrent-delete"),
};

const LINK = /^\/api\/torrent\/([a-f0-9]{40})\/(\d+)\//;
export const isMagnet = (s) => /^magnet:\?/i.test(String(s || "").trim());
export const hashOf = (url) => (LINK.exec(url || "") || [])[1] || null;
export const linkFor = (hash, f) => `/api/torrent/${hash}/${f.index}/${encodeURIComponent(f.name)}`;

let current = null;           // hash of the torrent playing
let files = [];
let poll = null;
let open = () => {};          // video.js openUrl, given in init (no import cycle)

const mb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`);
const say = (text) => { if (ui.status) ui.status.textContent = text; };

function renderFiles(selectedIndex) {
    if (!ui.file) return;
    ui.file.innerHTML = files.map((f) => `<option value="${f.index}">${escapeHtml(f.path || f.name)}</option>`).join("");
    if (selectedIndex !== undefined) ui.file.value = String(selectedIndex);
    ui.file.closest("label").hidden = files.length < 2;
}

async function refresh() {
    if (!current) return;
    try {
        const s = await getJson(`/api/torrent/${current}`);
        if (!s.running) { say(t("not sharing now")); return; }
        if (s.files && s.files.length) files = s.files;
        const playing = files.find((f) => String(f.index) === (ui.file && ui.file.value)) || files[0];
        say(t("⇣ {down} · ⇡ {up} · {peers} peers · {pct}% of this episode here")
            .replace("{down}", mb(s.down)).replace("{up}", mb(s.up)).replace("{peers}", String(s.peers))
            .replace("{pct}", String(playing ? playing.progress : 0)));
    } catch { /* the server restarted: the next poll tries again */ }
}

function show(hash, selectedIndex) {
    current = hash;
    if (!ui.bar) return;
    ui.bar.hidden = false;
    renderFiles(selectedIndex);
    clearInterval(poll);
    poll = setInterval(refresh, 2000);
    refresh();
}

// The video is going away (another one opens, or the page closes): stop sharing this torrent,
// unless the next video is another episode of it
export function leaving(nextUrl = "") {
    if (!current || hashOf(nextUrl) === current) return;
    navigator.sendBeacon(`/api/torrent/${current}/stop`);
    current = null;
    clearInterval(poll);
    if (ui.bar) ui.bar.hidden = true;
}

// A torrent link is being played (picked here, or reopened from "continue watching")
export async function attach(url) {
    const hash = hashOf(url);
    if (!hash) return;
    const index = Number(LINK.exec(url)[2]);
    if (hash !== current) files = [];
    show(hash, index);
    if (!files.length) {
        try { const s = await getJson(`/api/torrent/${hash}`); if (s.files) { files = s.files; renderFiles(index); } } catch { /* shown on the next poll */ }
    }
}

// a link to a .torrent file, like nyaa's download button (…/download/123456.torrent)
export const isTorrentLink = (s) => /^https?:\/\/\S+(\.torrent(\?|#|$)|\/download\/\d+\/?$)/i.test(String(s || "").trim());
export const isTorrentFile = (f) => !!f && /\.torrent$/i.test(f.name);

// Ask the server for the torrent's episodes and play the first. request() sends the magnet, the
// link or the file and resolves to the server's answer.
async function start(request) {
    if (ui.bar) ui.bar.hidden = false;
    say(t("asking the peers for the torrent's file list… (up to a minute and a half)"));
    try {
        const r = await request();
        files = r.files;
        current = r.hash;
        open(linkFor(r.hash, files[0]));
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

export function init({ openUrl }) {
    open = openUrl;
    if (!ui.bar) return;
    ui.file.addEventListener("change", () => {
        const f = files.find((x) => String(x.index) === ui.file.value);
        if (f && current) open(linkFor(current, f));
    });
    ui.del.addEventListener("click", async () => {
        if (!current || !confirm(t("stop this torrent and delete what it downloaded?"))) return;
        const hash = current;
        leaving();
        await fetch(`/api/torrent/${hash}`, { method: "DELETE" }).catch(() => {});
        say("");
    });
    window.addEventListener("pagehide", () => leaving());
}
