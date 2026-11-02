// What a backup is: every "akko-*" localStorage key plus IndexedDB (reading library, mined words),
// as one JSON file. Made and restored by Settings → Backup (scripts/backup.js) and by the
// automatic backups (scripts/core/auto-backup.js). Older backups kept mined words in localStorage
// ("akko-mined"); restoring one puts that key back and mining.js moves it on next load.
//
// The .zip is the same file plus the recordings (the IndexedDB "media" store: a mined word's line
// audio and the scene's picture), which are too big to keep in JSON: akko-backup.json, media.json
// (which file is whose, and its type) and media/<id>.audio / media/<id>.picture (scripts/core/zip.js).

import { idbAll, idbReplace, IDB_STORES } from "./idb.js";
import { makeZip, readZip, isZip } from "./zip.js";

const MEDIA = "media";           // not in IDB_STORES: backups carry it only in the .zip

const PREFIX = "akko-";
// where the sync got to and the other devices' time: they come back from akko's server (scripts/core/sync.js)
const NOT_BACKED_UP = new Set(["akko-sync", "akko-days-others", "akko-days-others-en"]);
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
    ourKeys().filter((k) => !NOT_BACKED_UP.has(k)).forEach((k) => { data[k] = localStorage.getItem(k); });
    const idb = {};
    for (const s of IDB_STORES) idb[s] = await idbAll(s).catch(() => []);
    return JSON.stringify({ app: APP, version: 3, exported: new Date().toISOString(), data, idb });
}

// everything, recordings too, as one .zip (made by Settings → Backup)
export async function buildBackupZip() {
    const files = [{ name: "akko-backup.json", data: await buildBackup(), compress: true }];
    const manifest = [];
    for (const m of await idbAll(MEDIA).catch(() => [])) {
        const record = { id: m.id };
        for (const kind of ["audio", "picture"]) {
            if (!m[kind]) continue;
            const name = `media/${encodeURIComponent(m.id)}.${kind}`;
            files.push({ name, data: m[kind] });
            record[kind] = { name, type: m[kind].type || "" };
        }
        if (record.audio || record.picture) manifest.push(record);
    }
    files.push({ name: "media.json", data: JSON.stringify(manifest), compress: true });
    return makeZip(files);
}

// the recordings a .zip backup carries, as the "media" store's records
async function mediaOf(files) {
    const byName = new Map(files.map((f) => [f.name, f]));
    const list = byName.get("media.json");
    if (!list) return [];
    const out = [];
    for (const m of JSON.parse(list.text())) {
        const record = { id: m.id };
        if (m.audio && byName.has(m.audio.name)) record.audio = byName.get(m.audio.name).blob(m.audio.type || "audio/webm");
        if (m.picture && byName.has(m.picture.name)) record.picture = byName.get(m.picture.name).blob(m.picture.type || "image/webp");
        if (record.audio || record.picture) out.push(record);
    }
    return out;
}

// a file's text -> {exported, data, idb}; throws if it isn't one
export function readBackup(text) {
    const file = JSON.parse(text);
    if (file.app !== APP || typeof file.data !== "object") throw new Error("that isn't an akko backup file");
    return {
        exported: file.exported,
        data: Object.fromEntries(Object.entries(file.data).filter(([k, v]) => k.startsWith(PREFIX) && typeof v === "string")),
        idb: file.idb && typeof file.idb === "object" ? file.idb : {},      // version 1 backups have none
    };
}

// a picked file (a .zip or a .json) -> the backup: as readBackup, plus {media} when it's a .zip
export async function readBackupFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isZip(bytes)) return { ...readBackup(new TextDecoder().decode(bytes)), media: null };
    const files = await readZip(bytes);
    const json = files.find((f) => f.name === "akko-backup.json");
    if (!json) throw new Error("that isn't an akko backup file");
    return { ...readBackup(json.text()), media: await mediaOf(files) };
}

// replace everything saved here with the backup's ({media} only comes from a .zip: a plain .json
// backup leaves the recordings where they are)
export async function applyBackup({ data, idb, media = null }) {
    ourKeys().forEach((k) => localStorage.removeItem(k));
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
    for (const s of IDB_STORES) await idbReplace(s, Array.isArray(idb[s]) ? idb[s] : []);
    if (Array.isArray(media)) await idbReplace(MEDIA, media);
}
