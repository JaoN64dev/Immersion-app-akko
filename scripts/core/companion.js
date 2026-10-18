// The akko companion browser extension (extension/, clickable subtitles on YouTube and Netflix),
// through the server (server/companion.js). Runs on every page of akko on this computer
// (scripts/site.js), in the desktop app's window too, every 20 seconds and when the page comes
// back to the front:
//   - what you did while watching comes in: mined words (into the mined list, so they show in
//     Stats and in 復習 with their sentence, and the line's audio and picture: scripts/core/media.js) and the time, which counts for "today" and the streak.
//     How far into the extension's log this window got: "akko-companion-at".
//   - your Anki settings and language go out to the extension. (Word statuses don't pass here:
//     the word list is shared through the server, scripts/core/words-sync.js.)
// What was watched, per video: "akko-companion-watched" {key: {site, title, url, seconds, when}}.

import { store } from "./utils.js";
import { idbPutMany } from "./idb.js";
import { daysKey } from "./today.js";
import { keepMedia } from "./media.js";

const AT = "akko-companion-at";             // {epoch, seq}
export const WATCHED = "akko-companion-watched";
const EVERY = 20e3;
const KEEP_WATCHED = 300;

let sent = "";
const local = () => /^(127\.0\.0\.1|localhost)$/.test(location.hostname);    // a phone has its own word list

function apply(entries) {
    const days = store.get(daysKey("ja"), {});
    const watched = store.get(WATCHED, {});
    const mined = [];
    let timeChanged = false;
    for (const e of entries) {
        if (e.kind === "time") {
            days[e.day] = (days[e.day] || 0) + e.seconds;
            const key = e.key || e.url || e.title;
            const w = watched[key] || { site: e.site, title: e.title, url: e.url, seconds: 0, when: 0 };
            watched[key] = { ...w, title: e.title || w.title, url: e.url || w.url, seconds: w.seconds + e.seconds, when: Math.max(w.when, e.at) };
            timeChanged = true;
        } else if (e.kind === "mined") {
            mined.push({ ...e.item, lang: "ja" });
        }
    }
    if (timeChanged) {
        store.set(daysKey("ja"), days);
        const newest = Object.entries(watched).sort((a, b) => b[1].when - a[1].when).slice(0, KEEP_WATCHED);
        store.set(WATCHED, Object.fromEntries(newest));
    }
    return mined;
}

async function takeLog() {
    const at = store.get(AT, { epoch: "", seq: 0 });
    const r = await fetch(`/api/companion/log?${new URLSearchParams({ after: at.seq, epoch: at.epoch })}`);
    if (!r.ok) return null;
    const { epoch, last, entries } = await r.json();
    if (entries.length) {
        const mined = apply(entries);
        if (mined.length) {
            await idbPutMany("mined", mined).catch(() => {});
            if ("BroadcastChannel" in window) new BroadcastChannel("akko-mined").postMessage("changed");
            // the line's audio and the picture, for 復習
            for (const m of mined.filter((x) => x.media)) {
                const got = {};
                for (const kind of Object.keys(m.media)) {
                    const r = await fetch(`/api/companion/media/${encodeURIComponent(m.id)}/${kind}`).catch(() => null);
                    if (r && r.ok) got[kind] = await r.blob();
                }
                await keepMedia(m.id, got);
            }
        }
    }
    const now = { epoch, seq: last };
    if (now.epoch !== at.epoch || now.seq !== at.seq) store.set(AT, now);     // (every write wakes the backup summary)
    return now;
}

async function sendApp(at) {
    const body = JSON.stringify({
        anki: store.get("akko-anki", null),
        native: store.get("akko-settings", {}).native || "",
    });
    if (body === sent) return;
    const r = await fetch("/api/companion/app", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    if (r.ok) sent = body;
}

async function sync() {
    try {
        // one window of this browser at a time, so nothing is counted twice
        const run = async () => { const at = await takeLog(); if (at) await sendApp(at); };
        if (navigator.locks) await navigator.locks.request("akko-companion", { ifAvailable: true }, (lock) => (lock ? run() : null));
        else await run();
    } catch { /* akko's server is restarting: next time */ }
}

export function start() {
    if (typeof document === "undefined" || !local()) return;
    sync();
    setInterval(sync, EVERY);          // also while the desktop app sits in the tray
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
}
