// What a backup is: every "akko-*" localStorage key plus IndexedDB (reading library, mined words),
// as one JSON file. Made and restored by Settings → Backup (scripts/backup.js) and by the
// automatic backups (scripts/core/auto-backup.js). Older backups kept mined words in localStorage
// ("akko-mined"); restoring one puts that key back and mining.js moves it on next load.

import { idbAll, idbReplace, IDB_STORES } from "./idb.js";

const PREFIX = "akko-";
export const APP = "akko-immersion";

export function ourKeys() {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith(PREFIX)) out.push(k);
        }
    } catch { /* storage off */ }
    return out;
}

// everything, as the backup file's text
export async function buildBackup() {
    const data = {};
    ourKeys().forEach((k) => { data[k] = localStorage.getItem(k); });
    const idb = {};
    for (const s of IDB_STORES) idb[s] = await idbAll(s).catch(() => []);
    return JSON.stringify({ app: APP, version: 3, exported: new Date().toISOString(), data, idb });
}

// a backup file's text -> {exported, data, idb}; throws if it isn't one
export function readBackup(text) {
    const file = JSON.parse(text);
    if (file.app !== APP || typeof file.data !== "object") throw new Error("that isn't an akko backup file");
    return {
        exported: file.exported,
        data: Object.fromEntries(Object.entries(file.data).filter(([k, v]) => k.startsWith(PREFIX) && typeof v === "string")),
        idb: file.idb && typeof file.idb === "object" ? file.idb : {},      // version 1 backups have none
    };
}

// replace everything saved here with the backup's
export async function applyBackup({ data, idb }) {
    ourKeys().forEach((k) => localStorage.removeItem(k));
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
    for (const s of IDB_STORES) await idbReplace(s, Array.isArray(idb[s]) ? idb[s] : []);
}
