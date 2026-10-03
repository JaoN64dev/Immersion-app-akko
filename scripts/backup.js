// Backup: every "akko-*" localStorage key plus IndexedDB (reading library, mined words) in
// one .json file, and restoring it. Older backups kept mined words in localStorage
// ("akko-mined"); restoring one puts that key back and mining.js moves it on next load.

import { $ } from "./core/dom.js";
import { store, download } from "./core/utils.js";
import { idbAll, idbCount, idbReplace, IDB_STORES } from "./core/idb.js";
import { wordCounts } from "./words/status.js";
import { KEY as PROGRESS_KEY } from "./progress.js";
import { t } from "./i18n.js";
import { keyFor } from "./core/target.js";

const PREFIX = "akko-";
const APP = "akko-immersion";

const summary = $("#backup-summary");
const msg = $("#backup-msg");
const input = $("#backup-import");

function ourKeys() {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith(PREFIX)) out.push(k);
        }
    } catch { /* storage off */ }
    return out;
}

function describe(words, minedCount, videos, texts) {
    const c = wordCounts(words);
    return `${c.known} known · ${c.learning} learning · ${c.ignored} ignored words · ${minedCount} mined · ${videos} videos in progress · ${texts} texts`;
}

async function renderSummary() {
    const last = store.get("akko-last-backup", null);
    const [texts, minedCount] = await Promise.all([idbCount("texts").catch(() => 0), idbCount("mined").catch(() => 0)]);
    summary.textContent = describe(store.get(keyFor("akko-words"), {}), minedCount, Object.keys(store.get(PROGRESS_KEY, {})).length, texts)
        + (last ? `  ·  last backup ${new Date(last).toLocaleDateString()}` : "  ·  never backed up");
}

async function exportBackup() {
    store.set("akko-last-backup", Date.now());
    const data = {};
    ourKeys().forEach((k) => { data[k] = localStorage.getItem(k); });
    const idb = {};
    for (const s of IDB_STORES) idb[s] = await idbAll(s).catch(() => []);
    const file = { app: APP, version: 3, exported: new Date().toISOString(), data, idb };
    download(`akko-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(file), "application/json");
    msg.textContent = "backup downloaded ✓";
    renderSummary();
}

async function restoreBackup() {
    const f = input.files[0];
    input.value = "";
    if (!f) return;
    let file;
    try {
        file = JSON.parse(await f.text());
        if (file.app !== APP || typeof file.data !== "object") throw new Error();
    } catch {
        msg.textContent = "that isn't an akko backup file";
        return;
    }
    const data = Object.fromEntries(Object.entries(file.data).filter(([k, v]) => k.startsWith(PREFIX) && typeof v === "string"));
    const idb = file.idb && typeof file.idb === "object" ? file.idb : {};      // version 1 backups have none
    const parse = (k, fallback) => { try { return JSON.parse(data[k]) ?? fallback; } catch { return fallback; } };
    const minedCount = (Array.isArray(idb.mined) ? idb.mined.length : 0) + parse("akko-mined", []).length;
    const what = describe(parse(keyFor("akko-words"), {}), minedCount,
        Object.keys(parse(PROGRESS_KEY, {})).length, (idb.texts || []).length);
    if (!confirm(t(`Restore the backup from ${new Date(file.exported).toLocaleString()}?\n\n${what}\n\nThis replaces everything saved in this browser right now.`))) return;

    try {
        ourKeys().forEach((k) => localStorage.removeItem(k));
        Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
        for (const s of IDB_STORES) await idbReplace(s, Array.isArray(idb[s]) ? idb[s] : []);
    } catch (err) {
        msg.textContent = "restore failed: " + err.message;
        return;
    }
    msg.textContent = "restored ✓ reloading…";
    setTimeout(() => location.reload(), 600);
}

export function init() {
    $("#backup-export").addEventListener("click", exportBackup);
    input.addEventListener("change", restoreBackup);

    // keep the summary current as things get saved
    let pending = null;
    window.addEventListener("akko-saved", () => {
        clearTimeout(pending);
        pending = setTimeout(renderSummary, 300);
    });
    renderSummary();
}
