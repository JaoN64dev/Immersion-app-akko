// Automatic backups: every few days, quietly, a backup of everything saved in this browser (or
// app window) goes to the server, which keeps the last 10 in its data folder (server/backups.js).
// Settings → Backup lists them and restores one. On by default; "akko-settings".autoBackup = false
// turns it off. Loaded on every page by scripts/site.js.

import { store } from "./utils.js";
import { buildBackup } from "./backup-file.js";
import { chosen } from "./target.js";

const SETTINGS = "akko-settings";
const LAST = "akko-auto-backup";       // when the last automatic one was made
const EVERY = 3 * 864e5;               // 3 days
const WAIT = 20e3;                     // after the page has settled

export const autoBackupOn = () => store.get(SETTINGS, {}).autoBackup !== false;
export function setAutoBackup(on) {
    store.set(SETTINGS, { ...store.get(SETTINGS, {}), autoBackup: on });
}

// make one now (also from Settings)
export async function backupNow() {
    const text = await buildBackup();
    const res = await fetch("/api/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `the server said ${res.status}`);
    const now = Date.now();
    store.set(LAST, now);
    store.set("akko-last-backup", now);        // the "time to back up" reminder counts it too
}

export function start() {
    if (!autoBackupOn() || !chosen()) return;
    if (Date.now() - store.get(LAST, 0) < EVERY) return;
    // only one tab or window at a time: whoever claims it first
    const claim = `${Date.now()}-${Math.random()}`;
    setTimeout(() => {
        if (store.get("akko-auto-backup-claim", { at: 0 }).at > Date.now() - 60e3) return;
        store.set("akko-auto-backup-claim", { at: Date.now(), claim });
        setTimeout(() => {
            if (store.get("akko-auto-backup-claim", {}).claim !== claim) return;
            backupNow().catch(() => { /* server off: next time */ });
        }, 500);
    }, WAIT);
}
