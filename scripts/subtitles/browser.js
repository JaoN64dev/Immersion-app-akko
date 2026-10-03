// Finding Japanese subtitles: kitsunekko.net + its GitHub mirror (anime), JP-Subtitles on
// GitHub (films, dramas, shows). All through our server.

import { el } from "../core/dom.js";
import { state } from "../core/state.js";
import { escapeHtml, getJson, episodeOf } from "../core/utils.js";
import { loadSubtitleText } from "../player/cues.js";
import * as progress from "../progress.js";

const SOURCES = { kitsunekko: "kitsunekko.net", github: "GitHub mirror", jpsubs: "JP-Subtitles (films & dramas)" };
const PLAYABLE = ["srt", "ass", "ssa", "vtt", "zip"];

let shows = null;           // folder list from every source (loaded on first use)
let sourceErrors = [];      // sources that failed to load
let folderChoices = [];     // folders offered for the selected anime
let files = [];             // what's in the open folder

const api = (what, source, params) => `/api/subs/${what}?` + new URLSearchParams({ source, ...params });
const folderValue = (s) => `${s.source}|${s.dir}`;

// ---------- the panel: open, folded to one line, or closed ----------

const showToggle = document.getElementById("show-toggle");

function foldPanel(folded) {
    el.showSection.classList.toggle("folded", folded);
    showToggle.textContent = folded ? "show list ▾" : "hide list ▴";
}

// after a subtitle is picked: the search results go, the list folds away
function tidyAfterPick() {
    el.results.innerHTML = "";
    el.searchStatus.textContent = "";
    foldPanel(true);
}

function closePanel() {
    el.showSection.hidden = true;
    el.results.innerHTML = "";
    el.searchStatus.textContent = "";
}

// ---------- folders ----------

// Folder lists from every source, merged. A source that's down just gets skipped (and
// tried again next time: only a complete list is kept).
let failedSources = {};      // source -> error message, from the last try
async function loadShows() {
    if (!shows) {
        const results = await Promise.allSettled(Object.keys(SOURCES).map(async (source) =>
            (await getJson(api("shows", source))).map((s) => ({
                ...s, source, label: `${s.name} — ${SOURCES[source]}`,
            }))));
        failedSources = {};
        results.forEach((r, i) => { if (r.status === "rejected") failedSources[Object.keys(SOURCES)[i]] = r.reason.message; });
        sourceErrors = Object.entries(failedSources).map(([source, msg]) => `${SOURCES[source]}: ${msg}`);
        const all = results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
        if (!all.length) throw new Error(sourceErrors.join("; "));
        el.folderList.innerHTML = all.map((s) => `<option value="${escapeHtml(s.label)}">`).join("");
        if (!sourceErrors.length) shows = all;
        return all;
    }
    return shows;
}

function renderFolderOptions(list) {
    el.folderSelect.innerHTML = Object.entries(SOURCES).map(([source, label]) => {
        const group = list.filter((s) => s.source === source);
        return group.length ? `<optgroup label="${label}">${group.map((s) =>
            `<option value="${escapeHtml(folderValue(s))}">${escapeHtml(s.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
}

const normTitle = (s) => (s || "").toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Score how well a folder name matches any of the anime's titles
function matchScore(folder, titles) {
    const f = normTitle(folder);
    const fTokens = new Set(f.split(" "));
    let best = 0;
    for (const t of titles) {
        const n = normTitle(t);
        if (!n) continue;
        if (n === f) return 1;
        const tTokens = n.split(" ");
        const shared = tTokens.filter((w) => fTokens.has(w)).length;
        let score = shared / Math.max(tTokens.length, fTokens.size);
        if (f.includes(n) || n.includes(f)) score = Math.max(score, 0.8);
        best = Math.max(best, score);
    }
    return best;
}

// An anime was picked in the search results
export async function selectAnime(anime) {
    state.anime = anime;
    progress.update({ anime });
    el.showSection.hidden = false;
    foldPanel(false);
    el.showCover.hidden = false;
    el.showCover.src = anime.coverImage.large;
    el.showNative.textContent = anime.title.native || anime.title.romaji;
    el.showRomaji.textContent = [anime.title.romaji, anime.title.english].filter(Boolean).join(" / ");
    el.showMeta.textContent = [anime.format, anime.seasonYear, anime.episodes && anime.episodes + " episodes"].filter(Boolean).join(" · ");
    el.showSection.scrollIntoView({ behavior: "smooth" });

    el.folderSelect.innerHTML = "";
    el.fileList.innerHTML = "";
    el.filesStatus.textContent = "looking for subtitle folders…";
    try {
        const titles = [anime.title.romaji, anime.title.english, anime.title.native, ...(anime.synonyms || [])];
        const matches = (await loadShows())
            .map((s) => ({ ...s, score: matchScore(s.name, titles) }))
            .filter((s) => s.score >= 0.34)
            .sort((a, b) => b.score - a.score)
            .slice(0, 16);
        folderChoices = matches;

        if (!matches.length) {
            el.filesStatus.textContent = "no folder matched automatically. try \"find another folder\" above.";
            return;
        }
        renderFolderOptions(matches);
        el.folderSelect.value = folderValue(matches[0]);
        openFolder(matches[0].source, matches[0].dir);
    } catch (err) {
        el.filesStatus.textContent = "couldn't reach the subtitle sites: " + err.message;
    }
}

// ---------- films & dramas (no AniList: search the folder names) ----------

// "Annihilation - アナイアレイション" -> {english: "Annihilation", japanese: "アナイアレイション"}
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;
function splitName(name) {
    const parts = name.split(/\s+-\s+/);
    const japanese = parts.filter((p) => JAPANESE.test(p)).join(" ");
    const english = parts.filter((p) => !JAPANESE.test(p)).join(" - ");
    return { japanese, english };
}

// Folders of the films & dramas source whose names match what was typed
export async function searchTitles(q) {
    const n = normTitle(q);
    const all = await loadShows();
    if (failedSources.jpsubs) {
        const oldServer = /unknown source/.test(failedSources.jpsubs);
        throw new Error(oldServer
            ? "the server is running an older version. restart it (close its window and open akko again)"
            : `couldn't load the films & dramas list (${failedSources.jpsubs})`);
    }
    return all
        .filter((s) => s.source === "jpsubs")
        .map((s) => ({ ...s, ...splitName(s.name), score: normTitle(s.name).includes(n) ? 1 : matchScore(s.name, [q]) }))
        .filter((s) => s.score >= 0.34)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, 36);
}

// A film or drama was picked: same panel as an anime, without a cover
export function selectTitle(show) {
    state.anime = null;
    el.showSection.hidden = false;
    foldPanel(false);
    el.showCover.hidden = true;
    el.showCover.removeAttribute("src");
    el.showNative.textContent = show.japanese || show.english || show.name;
    el.showRomaji.textContent = show.japanese ? show.english : "";
    el.showMeta.textContent = "film / drama · " + SOURCES[show.source];
    el.showSection.scrollIntoView({ behavior: "smooth" });

    folderChoices = [show];
    renderFolderOptions(folderChoices);
    el.folderSelect.value = folderValue(show);
    el.fileList.innerHTML = "";
    openFolder(show.source, show.dir);
}

// ---------- files ----------

async function openFolder(source, dir) {
    el.filesStatus.textContent = "loading files…";
    el.fileList.innerHTML = "";
    try {
        const listing = await getJson(api("files", source, { dir }));
        files = [
            ...listing.folders.map((f) => ({ ...f, source, isFolder: true })),
            ...listing.files.map((f) => ({ ...f, source })),
        ];
        const where = dir.replace("subtitles/japanese/", "").replace(/^anime_(tv|movie)\//, "");
        el.filesStatus.textContent = `${listing.files.length} files · ${where} · ${SOURCES[source]}`
            + (sourceErrors.length ? `  (unavailable: ${sourceErrors.join("; ")})` : "");
        renderFiles();
    } catch (err) {
        el.filesStatus.textContent = "error: " + err.message;
    }
}

// The file list, filtered, with files matching the loaded video's episode highlighted
export function renderFiles() {
    const filter = el.fileFilter.value.trim().toLowerCase();
    const filterEp = /^\d+$/.test(filter) ? Number(filter) : null;
    const videoEp = state.videoName ? episodeOf(state.videoName) : null;

    el.fileList.innerHTML = "";
    for (const f of files) {
        const ep = f.isFolder ? null : episodeOf(f.name);
        if (filter && !(f.name.toLowerCase().includes(filter) || (filterEp !== null && ep === filterEp))) continue;

        const li = document.createElement("li");
        const ok = f.isFolder || PLAYABLE.includes(f.ext);
        li.className = [ok ? "" : "disabled", !f.isFolder && videoEp !== null && ep === videoEp ? "match" : ""].join(" ");
        li.innerHTML = f.isFolder
            ? `<span class="icon">📂</span><span class="name">${escapeHtml(f.name)}</span>`
            : `<span class="icon">${f.ext === "zip" ? "📦" : "💬"}</span>
               <span class="name">${escapeHtml(f.name)}</span>
               <span class="size">${ok ? Math.round(f.size / 1024) + " KB" : "." + f.ext + " unsupported"}</span>`;
        if (ok) li.addEventListener("click", () => (f.isFolder ? openFolder(f.source, f.dir) : pickFile(f, li)));
        el.fileList.appendChild(li);
    }
}

async function pickFile(file, li) {
    const url = api("file", file.source, { path: file.path });
    try {
        li.classList.add("loading");
        if (file.ext === "zip") {
            const { entries } = await getJson(url);
            li.classList.remove("loading");
            showZipEntries(file, li, entries);
            return;
        }
        const sub = await getJson(url);
        loadSubtitleText(sub.text, sub.ext, sub.name);
        tidyAfterPick();
    } catch (err) {
        el.filesStatus.textContent = "error: " + err.message;
    } finally {
        li.classList.remove("loading");
    }
}

// Clicking a zip toggles a list of the subtitle files inside it
function showZipEntries(file, li, entries) {
    const existing = li.nextElementSibling;
    if (existing && existing.classList.contains("zip-entries")) { existing.remove(); return; }
    const videoEp = state.videoName ? episodeOf(state.videoName) : null;
    const list = document.createElement("ul");
    list.className = "zip-entries";
    if (!entries.length) list.innerHTML = "<li class='disabled'>no subtitle files inside</li>";
    for (const entry of entries) {
        const item = document.createElement("li");
        if (videoEp !== null && episodeOf(entry) === videoEp) item.classList.add("match");
        item.innerHTML = `<span class="icon">💬</span><span class="name">${escapeHtml(entry)}</span>`;
        item.addEventListener("click", async () => {
            item.classList.add("loading");
            try {
                const s = await getJson(api("file", file.source, { path: file.path, entry }));
                loadSubtitleText(s.text, s.ext, s.name);
                tidyAfterPick();
            } catch (err) {
                el.filesStatus.textContent = "error: " + err.message;
            } finally {
                item.classList.remove("loading");
            }
        });
        list.appendChild(item);
    }
    li.after(list);
}

// A subtitle file from your own computer
async function loadOwnFile() {
    const file = el.subFile.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch { text = new TextDecoder("shift_jis").decode(buf); }
    loadSubtitleText(text.replace(/^﻿/, ""), file.name.split(".").pop().toLowerCase(), file.name);
}

export function init() {
    showToggle.addEventListener("click", () => foldPanel(!el.showSection.classList.contains("folded")));
    document.getElementById("show-close").addEventListener("click", closePanel);
    el.folderSelect.addEventListener("change", () => {
        const [source, ...rest] = el.folderSelect.value.split("|");
        openFolder(source, rest.join("|"));
    });

    el.folderFilter.addEventListener("change", async () => {
        const pick = (await loadShows()).find((s) => s.label === el.folderFilter.value);
        if (!pick) return;
        if (!folderChoices.includes(pick)) {
            folderChoices = [pick, ...folderChoices];
            renderFolderOptions(folderChoices);
        }
        el.folderSelect.value = folderValue(pick);
        el.folderFilter.value = "";
        openFolder(pick.source, pick.dir);
    });

    el.fileFilter.addEventListener("input", renderFiles);
    el.subFile.addEventListener("change", loadOwnFile);
}
