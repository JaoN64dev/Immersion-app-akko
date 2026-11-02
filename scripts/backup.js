// Settings → Backup: download everything as one .json file (or a .zip with the recordings too),
// restore either, and the automatic backups the server keeps (scripts/core/auto-backup.js).
// What a backup is: scripts/core/backup-file.js.

import { $ } from "./core/dom.js";
import { store, download, getJson, escapeHtml } from "./core/utils.js";
import { idbCount } from "./core/idb.js";
import { wordCounts } from "./words/status.js";
import { KEY as PROGRESS_KEY } from "./progress.js";
import { t } from "./i18n.js";
import { keyFor } from "./core/target.js";
import { buildBackup, buildBackupZip, readBackup, readBackupFile, applyBackup } from "./core/backup-file.js";
import { autoBackupOn, setAutoBackup, backupNow } from "./core/auto-backup.js";
import { restored as wordsRestored } from "./core/words-sync.js";
import { restored as syncRestored } from "./core/sync.js";

const summary = $("#backup-summary");
const msg = $("#backup-msg");
const input = $("#backup-import");
const autoUi = { on: $("#auto-backup-on"), list: $("#auto-backup-list"), folder: $("#auto-backup-folder") };

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
    download(`akko-backup-${new Date().toISOString().slice(0, 10)}.json`, await buildBackup(), "application/json");
    msg.textContent = "backup downloaded ✓";
    renderSummary();
}

// everything, the mined words' line audio and pictures too: a .zip
async function exportZip() {
    msg.textContent = t("putting the recordings in…");
    try {
        const zip = await buildBackupZip();
        store.set("akko-last-backup", Date.now());
        download(`akko-backup-${new Date().toISOString().slice(0, 10)}.zip`, zip, "application/zip");
        msg.textContent = "backup downloaded ✓";
    } catch (err) {
        msg.textContent = "backup failed: " + err.message;
    }
    renderSummary();
}

// restore from a backup (a picked file, or an automatic one's text)
async function restoreFrom(backup) {
    const { data, idb } = backup;
    const parse = (k, fallback) => { try { return JSON.parse(data[k]) ?? fallback; } catch { return fallback; } };
    const minedCount = (Array.isArray(idb.mined) ? idb.mined.length : 0) + parse("akko-mined", []).length;
    const what = describe(parse(keyFor("akko-words"), {}), minedCount,
        Object.keys(parse(PROGRESS_KEY, {})).length, (idb.texts || []).length)
        + (Array.isArray(backup.media) ? ` · ${t("{n} recordings").replace("{n}", backup.media.length)}` : "");
    if (!confirm(t(`Restore the backup from ${new Date(backup.exported).toLocaleString()}?\n\n${what}\n\nThis replaces everything saved in this browser right now.`))) return;
    try {
        await applyBackup(backup);
        wordsRestored();             // the shared word list becomes the backup's (scripts/core/words-sync.js)
        syncRestored();              // and the rest of what's shared (scripts/core/sync.js)
    } catch (err) {
        msg.textContent = "restore failed: " + err.message;
        return;
    }
    msg.textContent = "restored ✓ reloading…";
    setTimeout(() => location.reload(), 600);
}

// a picked .json or .zip file
async function restoreFile(file) {
    msg.textContent = t("reading the backup…");
    let backup;
    try {
        backup = await readBackupFile(file);
    } catch {
        msg.textContent = "that isn't an akko backup file";
        return;
    }
    await restoreFrom(backup);
}

// an automatic backup, which is the .json the server keeps (server/backups.js)
async function restoreText(text) {
    let backup;
    try {
        backup = readBackup(text);
    } catch {
        msg.textContent = "that isn't an akko backup file";
        return;
    }
    await restoreFrom(backup);
}

async function restoreBackup() {
    const f = input.files[0];
    input.value = "";
    if (f) restoreFile(f);
}

// ---------- automatic backups ----------

const size = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

async function renderAuto() {
    autoUi.on.checked = autoBackupOn();
    let list;
    try { list = await getJson("/api/backups"); } catch { autoUi.list.innerHTML = ""; return; }
    autoUi.folder.textContent = list.folder;
    autoUi.list.innerHTML = list.backups.length
        ? list.backups.map((b) => `<li><span>${new Date(b.date).toLocaleString()}</span> <small>${size(b.size)}</small>
            <button type="button" data-name="${escapeHtml(b.name)}">restore this one</button></li>`).join("")
        : `<li class="muted">none yet: the first one is made within a few minutes</li>`;
}

export function init() {
    $("#backup-export").addEventListener("click", exportBackup);
    $("#backup-export-zip").addEventListener("click", exportZip);
    input.addEventListener("change", restoreBackup);
    autoUi.on.addEventListener("input", () => setAutoBackup(autoUi.on.checked));
    $("#auto-backup-now").addEventListener("click", async () => {
        msg.textContent = "backing up…";
        try { await backupNow(); msg.textContent = "backup saved ✓"; } catch (err) { msg.textContent = "backup failed: " + err.message; }
        renderAuto();
        renderSummary();
    });
    autoUi.list.addEventListener("click", async (e) => {
        const b = e.target.closest("button[data-name]");
        if (!b) return;
        try {
            const res = await fetch(`/api/backups/${encodeURIComponent(b.dataset.name)}`);
            if (!res.ok) throw new Error(`${res.status}`);
            restoreText(await res.text());
        } catch (err) {
            msg.textContent = "couldn't read that backup: " + err.message;
        }
    });
    renderAuto();

    // keep the summary current as things get saved
    let pending = null;
    window.addEventListener("akko-saved", () => {
        clearTimeout(pending);
        pending = setTimeout(renderSummary, 300);
    });
    renderSummary();
}
