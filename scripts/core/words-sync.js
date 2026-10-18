// One word list everywhere: keeps this page's copy of the word statuses in step with akko's
// server (server/words.js), which shares it with akko's other windows, phones and the browser
// extension. Runs on every page (scripts/site.js): a few seconds after a word is marked, every
// 5 seconds while the page is in front (every minute behind), and when it comes back to the front.
//   - sends what changed here ("akko-words-pending", filled by scripts/words/status.js)
//   - takes what changed elsewhere (scripts/words/status.js applyRemote, so the page re-colours)
// The first time, this page's whole list is merged in (after a backup is restored, the backup
// wins over the server). Where it got to: "akko-words-sync" {ja: {id, v}, en: {id, v}}.

import { store } from "./utils.js";
import { target } from "./target.js";
import { applyRemote } from "../words/status.js";

const STATE = "akko-words-sync";
const KEYS = { ja: "akko-words", en: "akko-words-en" };
const FRONT = 5e3, BEHIND = 60e3;

async function syncLang(lang) {
    // the same names scripts/words/status.js uses (keyFor: "-en" at the end for English)
    const key = KEYS[lang], pendingKey = lang === "en" ? "akko-words-pending-en" : "akko-words-pending";
    const states = store.get(STATE, {});
    const st = states[lang] || {};
    const sent = store.get(pendingKey, {});
    const body = { lang, id: st.id || "", since: st.v || 0, changes: sent };
    // first time here (or a backup was just restored): this page's whole list joins in
    if (!st.id) body.merge = { words: store.get(key, {}), prefer: st.restored ? "local" : "server" };
    const res = await fetch("/api/words/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return;
    const r = await res.json();
    // what was sent isn't pending any more (unless it changed again meanwhile)
    const waiting = store.get(pendingKey, {});
    let left = false;
    for (const [w, s] of Object.entries(sent)) if (waiting[w] === s) { delete waiting[w]; left = true; }
    if (left) store.set(pendingKey, waiting);
    const remote = r.full || r.changes || {};
    if (lang === target()) applyRemote(remote, { full: !!r.full });
    else if (r.full || Object.keys(remote).length) {
        // the other language: only its stored copy; words still waiting to be sent keep theirs
        const list = r.full ? { ...r.full } : store.get(key, {});
        if (!r.full) for (const [w, s] of Object.entries(remote)) { if (s === "new") delete list[w]; else list[w] = s; }
        for (const [w, s] of Object.entries(waiting)) { if (s === "new") delete list[w]; else list[w] = s; }
        store.set(key, list);
    }
    if (st.id !== r.id || st.v !== r.v || st.restored) store.set(STATE, { ...store.get(STATE, {}), [lang]: { id: r.id, v: r.v } });
}

let running = null;
async function sync() {
    if (running) return running;
    running = (async () => {
        try {
            const job = async () => { for (const lang of Object.keys(KEYS)) await syncLang(lang); };
            // one tab of this browser at a time
            if (navigator.locks) await navigator.locks.request("akko-words-sync", job); else await job();
        } catch { /* the server is restarting: next time */ }
        finally { running = null; }
    })();
    return running;
}

// After a backup is restored: its list wins over the server's on the next sync
export function restored() {
    const states = {};
    for (const lang of Object.keys(KEYS)) states[lang] = { restored: true };
    store.set(STATE, states);
}

export function start() {
    if (typeof document === "undefined") return;
    sync();
    let soon = null;
    window.addEventListener("akko-words-changed", () => { clearTimeout(soon); soon = setTimeout(sync, 1500); });
    const tick = () => { setTimeout(async () => { await sync(); tick(); }, document.visibilityState === "visible" ? FRONT : BEHIND); };
    tick();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
}
