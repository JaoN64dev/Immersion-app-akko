// Finding podcasts (iTunes directory, Japan), saving favourites, and a podcast's episode list

import { $ } from "../core/dom.js";
import { store, escapeHtml, getJson, timeFormatter } from "../core/utils.js";
import { loadFeed } from "./feed.js";
import * as player from "./player.js";
import { keyFor, learningEnglish } from "../core/target.js";

const SAVED = keyFor("akko-podcasts");
const PAGE = 30;

const ui = {
    form: $("#pod-search"), query: $("#pod-query"), status: $("#pod-search-status"),
    results: $("#pod-results"), saved: $("#pod-saved"),
    show: $("#pod-show"), art: $("#pod-show-art"), title: $("#pod-show-title"), author: $("#pod-show-author"),
    save: $("#pod-save"), showStatus: $("#pod-show-status"), episodes: $("#pod-episodes"), more: $("#pod-more"),
};

let open = null;       // {podcast, feed}
let shown = 0;         // episodes listed so far

// ---------- search ----------

async function search(q) {
    ui.status.textContent = learningEnglish() ? "searching…" : "探しています…";
    ui.results.innerHTML = "";
    try {
        const data = await getJson("https://itunes.apple.com/search?" + new URLSearchParams({ media: "podcast", country: learningEnglish() ? "US" : "JP", limit: "24", term: q }));
        const list = data.results.filter((r) => r.feedUrl).map((r) => ({
            id: String(r.collectionId), title: r.collectionName, author: r.artistName,
            art: r.artworkUrl600 || r.artworkUrl100, feedUrl: r.feedUrl, genre: r.primaryGenreName,
        }));
        ui.status.textContent = list.length ? "" : "nothing found :(";
        renderCards(ui.results, list);
    } catch (err) {
        ui.status.textContent = "search failed: " + err.message;
    }
}

function renderCards(box, list) {
    box.innerHTML = "";
    for (const p of list) {
        const card = document.createElement("button");
        card.className = "card";
        card.innerHTML = `
            <img src="${escapeHtml(p.art || "")}" alt="" loading="lazy">
            <span class="card-native" lang="ja">${escapeHtml(p.title)}</span>
            <span class="card-romaji">${escapeHtml(p.author || "")}</span>
            ${p.genre ? `<span class="card-meta">${escapeHtml(p.genre)}</span>` : ""}`;
        card.addEventListener("click", () => openPodcast(p));
        box.appendChild(card);
    }
}

// ---------- saved ----------

const saved = () => store.get(SAVED, []);
const isSaved = (p) => saved().some((s) => s.feedUrl === p.feedUrl);

function renderSaved() {
    const list = saved();
    if (!list.length) {
        ui.saved.innerHTML = `<p class="empty-light">nothing saved yet. open a podcast and press “save”.</p>`;
        return;
    }
    renderCards(ui.saved, list);
}

function toggleSave() {
    const p = open.podcast;
    store.set(SAVED, isSaved(p) ? saved().filter((s) => s.feedUrl !== p.feedUrl) : [p, ...saved()]);
    ui.save.textContent = isSaved(p) ? "saved ✓" : "save";
    renderSaved();
}

// ---------- one podcast ----------

async function openPodcast(p) {
    ui.show.hidden = false;
    ui.art.src = p.art || "";
    ui.title.textContent = p.title;
    ui.author.textContent = p.author || "";
    ui.save.textContent = isSaved(p) ? "saved ✓" : "save";
    ui.episodes.innerHTML = "";
    ui.more.hidden = true;
    ui.showStatus.textContent = "loading episodes…";
    open = { podcast: p, feed: null };
    ui.show.scrollIntoView({ behavior: "smooth" });
    try {
        const feed = await loadFeed(p.feedUrl);
        if (open.podcast !== p) return;
        open.feed = feed;
        if (!p.art && feed.image) ui.art.src = p.art = feed.image;
        const withText = feed.episodes.filter((e) => e.transcripts.length).length;
        ui.showStatus.textContent = `${feed.episodes.length} episodes` + (withText ? ` · ${withText} with transcripts` : " · no transcripts");
        shown = 0;
        renderMore();
    } catch (err) {
        ui.showStatus.textContent = "couldn't load this podcast: " + err.message;
    }
}

function episodeHtml(ep, i) {
    const prog = player.progressOf(ep.guid);
    const pct = prog && prog.duration ? Math.min(100, (prog.time / prog.duration) * 100) : 0;
    const meta = [
        ep.date && !isNaN(ep.date) ? ep.date.toLocaleDateString() : "",
        ep.duration ? timeFormatter(ep.duration) : "",
        prog && prog.done ? "✓ played" : pct ? `${Math.round(pct)}% played` : "",
    ].filter(Boolean).join(" · ");
    return `<li class="episode${prog && prog.done ? " done" : ""}" data-i="${i}">
        <button class="play" title="play">▶</button>
        <div class="episode-main">
            <b lang="ja">${escapeHtml(ep.title)}</b>
            <span class="episode-meta">${meta}${ep.transcripts.length ? ` <span class="tag">transcript</span>` : ""}</span>
            ${ep.description ? `<p class="episode-desc" lang="ja">${escapeHtml(ep.description)}</p>` : ""}
            ${pct && !(prog && prog.done) ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ""}
        </div>
    </li>`;
}

function renderMore() {
    const eps = open.feed.episodes;
    ui.episodes.insertAdjacentHTML("beforeend", eps.slice(shown, shown + PAGE).map((ep, k) => episodeHtml(ep, shown + k)).join(""));
    shown = Math.min(eps.length, shown + PAGE);
    ui.more.hidden = shown >= eps.length;
}

// progress changed: redraw the listed episodes' "played" info
export function refreshEpisodes() {
    if (!open || !open.feed) return;
    ui.episodes.innerHTML = open.feed.episodes.slice(0, shown).map(episodeHtml).join("");
}

export function init() {
    ui.form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = ui.query.value.trim();
        if (q) search(q);
    });
    document.querySelectorAll(".chip[data-q]").forEach((chip) => chip.addEventListener("click", () => {
        ui.query.value = chip.dataset.q;
        search(chip.dataset.q);
    }));
    ui.save.addEventListener("click", toggleSave);
    ui.more.addEventListener("click", renderMore);
    ui.episodes.addEventListener("click", (e) => {
        const li = e.target.closest(".episode");
        if (li) player.play(open.feed.episodes[Number(li.dataset.i)], { ...open.podcast, image: open.feed.image });
    });
    renderSaved();
}
