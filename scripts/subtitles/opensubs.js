// English subtitles from OpenSubtitles (Watch page, when learning English). The server talks to
// OpenSubtitles with your API key (Settings); a picked subtitle loads like your own file would.

import { $ } from "../core/dom.js";
import { escapeHtml, getJson, postJson } from "../core/utils.js";
import { learningEnglish } from "../core/target.js";
import { loadSubtitleText } from "../player/cues.js";

const ui = {
    form: $("#os-form"), query: $("#os-query"), season: $("#os-season"), episode: $("#os-episode"),
    status: $("#os-status"), results: $("#os-results"),
};

let results = [];

function say(html) { ui.status.innerHTML = html; }

const NO_KEY = `to search here, add your free OpenSubtitles API key in <a href="/settings.html#subtitles-section">Settings</a>. or load a subtitle file below.`;

async function search(e) {
    e.preventDefault();
    const q = ui.query.value.trim();
    if (!q) return;
    say("searching…");
    ui.results.innerHTML = "";
    try {
        const params = new URLSearchParams({ q, lang: "en" });
        if (ui.season.value) params.set("season", ui.season.value);
        if (ui.episode.value) params.set("episode", ui.episode.value);
        results = (await getJson("/api/opensubs/search?" + params)).results;
        say(results.length ? `${results.length} subtitles · click one to load it` : "nothing found :(");
        ui.results.innerHTML = results.map((r, i) => `
            <li data-i="${i}" title="${escapeHtml(r.files[0].name || r.release)}">
                <span class="icon">💬</span>
                <span class="name">${escapeHtml(r.title)}${r.year ? ` (${r.year})` : ""}${r.season ? ` · S${r.season}E${r.episode || "?"}` : ""}
                    <small>${escapeHtml(r.release)}</small></span>
                <span class="size">${r.downloads.toLocaleString()} ⬇${r.hearingImpaired ? " · HI" : ""}${r.machineTranslated ? " · machine" : ""}</span>
            </li>`).join("");
    } catch (err) {
        say(/API key/.test(err.message) ? NO_KEY : "search failed: " + escapeHtml(err.message));
    }
}

async function pick(e) {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    const r = results[Number(li.dataset.i)];
    say("downloading…");
    try {
        const sub = await postJson("/api/opensubs/download", { fileId: r.files[0].id });
        loadSubtitleText(sub.text.replace(/^﻿/, ""), (sub.name.split(".").pop() || "srt").toLowerCase(), sub.name);
        say(`loaded ${escapeHtml(sub.name)}` + (sub.remaining != null ? ` · ${sub.remaining} downloads left today` : ""));
    } catch (err) {
        say("download failed: " + escapeHtml(err.message));
    }
}

export async function init() {
    if (!learningEnglish()) return;
    ui.form.addEventListener("submit", search);
    ui.results.addEventListener("click", pick);
    try {
        if (!(await getJson("/api/opensubs/status")).configured) say(NO_KEY);
    } catch { /* an older server: the search just won't work */ }
}
