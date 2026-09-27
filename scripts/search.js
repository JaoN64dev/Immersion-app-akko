// Search: anime through AniList, or films & dramas straight from the JP-Subtitles folder names

import { el } from "./core/dom.js";
import { escapeHtml, getJson, store } from "./core/utils.js";
import { selectAnime, searchTitles, selectTitle } from "./subtitles/browser.js";

const ANILIST_QUERY = `
query ($q: String) {
  Page(perPage: 18) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      synonyms
      coverImage { large }
      episodes
      seasonYear
      format
    }
  }
}`;

async function search(q) {
    el.searchStatus.textContent = "探しています…";
    el.results.innerHTML = "";
    try {
        const data = await getJson("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: ANILIST_QUERY, variables: { q } }),
        });
        const list = data.data.Page.media;
        el.searchStatus.textContent = list.length ? "" : "nothing found :(";
        renderResults(list);
    } catch (err) {
        el.searchStatus.textContent = "search failed: " + err.message;
    }
}

async function searchFilms(q) {
    el.searchStatus.textContent = "探しています…";
    el.results.innerHTML = "";
    try {
        const list = await searchTitles(q);
        el.searchStatus.textContent = list.length ? "" : "nothing found :( (JP-Subtitles has about 1000 films, dramas and shows, mostly up to 2022)";
        for (const show of list) {
            const card = document.createElement("button");
            card.className = "card";
            card.innerHTML = `
                <span class="card-noimg" aria-hidden="true">映</span>
                <span class="card-native" lang="ja">${escapeHtml(show.japanese || show.english)}</span>
                <span class="card-romaji">${escapeHtml(show.japanese ? show.english : "")}</span>
                <span class="card-meta">film / drama</span>`;
            card.addEventListener("click", () => selectTitle(show));
            el.results.appendChild(card);
        }
    } catch (err) {
        el.searchStatus.textContent = "search failed: " + err.message;
    }
}

const PLACEHOLDER = {
    anime: "search an anime… (e.g. Frieren, 3-gatsu no Lion)",
    film: "search a film or drama… (e.g. 半沢直樹, Terrace House, 1922)",
};

function setKind(kind) {
    el.searchKind.value = kind;
    el.searchInput.placeholder = PLACEHOLDER[kind];
    store.set("akko-search-kind", kind);
}

function renderResults(list) {
    el.results.innerHTML = "";
    for (const anime of list) {
        const card = document.createElement("button");
        card.className = "card";
        card.innerHTML = `
            <img src="${escapeHtml(anime.coverImage.large)}" alt="" loading="lazy">
            <span class="card-native" lang="ja">${escapeHtml(anime.title.native || "")}</span>
            <span class="card-romaji">${escapeHtml(anime.title.romaji || anime.title.english || "")}</span>
            <span class="card-meta">${[anime.format, anime.seasonYear, anime.episodes && anime.episodes + " eps"].filter(Boolean).join(" · ")}</span>`;
        card.addEventListener("click", () => selectAnime(anime));
        el.results.appendChild(card);
    }
}

export function init() {
    el.searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = el.searchInput.value.trim();
        if (!q) return;
        if (el.searchKind.value === "film") searchFilms(q); else search(q);
    });
    el.searchKind.addEventListener("change", () => {
        setKind(el.searchKind.value);
        el.results.innerHTML = "";
        el.searchStatus.textContent = "";
        el.searchInput.focus();
    });
    setKind(store.get("akko-search-kind", "anime") === "film" ? "film" : "anime");
}
