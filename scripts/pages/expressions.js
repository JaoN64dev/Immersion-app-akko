// 表現 Expressions (expressions.html): every idiom, proverb, 四字熟語 and everyday phrase JMdict
// knows, in sets, and the ones you've met — when, where, and the sentence it came from.
//
// The matching is server/expressions.js (the words of a line against the expressions' words); the
// catalogue and the sets come from /api/expressions (server/dictionary.js). The ones you've met are
// the keys of "akko-expressions" (scripts/words/render.js: an idiom underlined in a text, or any
// expression given a status in the popup) — older ones are just a date; mined expressions also have
// their sentence, source and line (IndexedDB "mined", scripts/mining.js).

import { $ } from "../core/dom.js";
import { store, escapeHtml, getJson } from "../core/utils.js";
import { keyFor, target } from "../core/target.js";
import { wordStatus } from "../words/status.js";
import { loadMined } from "../mining.js";
import { t } from "../i18n.js";

const MET = keyFor("akko-expressions");
const PAGE = 120;
const LABELS = { idioms: "idiom", yoji: "四字熟語", kotowaza: "proverb", phrases: "phrase" };

const ui = {
    today: $("#expressions-today"),
    browse: $("#expressions-browse"),
    search: $("#expressions-search"),
    sets: $("#expressions-sets"),
    parts: $("#expressions-parts"),
    count: $("#expressions-count"),
    list: $("#expressions-list"),
    more: $("#expressions-more"),
    metList: $("#expressions-met-list"),
};

const view = { set: "all", part: "", q: "" };
let counts = { sets: [], parts: [] };
let total = 0;
let shown = [];            // the items in the list now
let job = 0;               // bumps on a new search, so a late answer is dropped
let mined = [];            // mined word -> its sentence and source
let metMap = {};

const en = () => target() === "en";
const since = (at) => new Date(at).toLocaleDateString();
const metLine = (at) => t("met {date}").replace("{date}", since(at));

// ---------- what you've met ----------

const metInfo = (key) => {
    const v = metMap[key];
    if (!v) return null;
    return typeof v === "number" ? { at: v } : v;
};

function mineOf(key) {
    return mined.find((m) => m.word === key || m.surface === key) || null;
}

// where and when: the popup's record, else the mined card (its sentence, its source)
function contextOf(key) {
    const met = metInfo(key);
    const m = mineOf(key);
    return {
        at: met ? met.at : m ? m.added : null,
        sentence: (met && met.sentence) || (m && m.sentence) || "",
        source: (met && met.source) || (m && m.source) || "",
        time: (met && met.time) || (m && m.time) || "",
    };
}

const metKeys = () => Object.keys(metMap);

// ---------- one expression ----------

function tagsOf(it) {
    const tags = (it.sets || []).map((s) => LABELS[s] || s).filter((s) => s !== "idiom" || it.sets.length === 1);
    return tags.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join("");
}

function contextHtml(key) {
    const c = contextOf(key);
    if (!c.at && !c.sentence) return "";
    const where = [c.source, c.time].filter(Boolean).join(" ");
    return `<div class="expression-context">
        <p class="expression-met">${c.at ? escapeHtml(metLine(c.at)) : ""}${where ? ` · ${escapeHtml(where)}` : ""}</p>
        ${c.sentence ? `<p class="expression-sentence" lang="${target()}" translate="no">${escapeHtml(c.sentence)}</p>` : ""}
    </div>`;
}

function statusHtml(key) {
    const s = wordStatus(key);
    return s && s !== "new" ? `<span class="expression-status st-${s}">${escapeHtml(t(s))}</span>` : "";
}

function itemHtml(it) {
    const met = !!metInfo(it.key);
    return `<li class="expression${met ? " met" : ""}" data-key="${escapeHtml(it.key)}">
        <div class="expression-head">
            <b class="expression-key" lang="${target()}" translate="no">${escapeHtml(it.key)}</b>
            ${it.reading ? `<span class="expression-reading" lang="ja" translate="no">${escapeHtml(it.reading)}</span>` : ""}
            <span class="expression-tags">${tagsOf(it)}</span>
            ${statusHtml(it.key)}
            ${met ? `<span class="expression-met-mark" title="${escapeHtml(t("you've met this one"))}">✓</span>` : ""}
        </div>
        ${(it.gloss || []).length ? `<ol class="expression-gloss" translate="no">${it.gloss.map((g) => `<li>${escapeHtml(g)}</li>`).join("")}</ol>` : ""}
        ${contextHtml(it.key)}
    </li>`;
}

// ---------- the catalogue ----------

const query = () => {
    const qs = new URLSearchParams({ set: view.set, offset: String(shown.length), limit: String(PAGE) });
    if (view.part) qs.set("part", view.part);
    if (view.q) qs.set("q", view.q);
    return qs;
};

function renderSets() {
    const button = (id, label, count, extra = "") =>
        `<button type="button" role="tab" data-set="${escapeHtml(id)}"${extra} aria-selected="${extra ? view.part === id : view.set === id}">${label}${count === undefined ? "" : ` <small>${count.toLocaleString("en-US")}</small>`}</button>`;
    ui.sets.innerHTML = counts.sets.map((s) => button(s.id, s.id === "all" ? t("all") : escapeHtml(LABELS[s.id] || s.id), s.count)).join("");
    ui.parts.innerHTML = counts.parts.length
        ? `<span class="expressions-parts-label">${t("with a body part")}:</span> `
            + counts.parts.map((p) => button(p.id, `<span lang="ja">${escapeHtml(p.id)}</span>`, p.count, "part")).join("")
        : "";
}

function renderCount() {
    const met = metKeys().length;
    ui.count.textContent = t("{n} expressions").replace("{n}", total.toLocaleString("en-US"))
        + (met ? ` · ${t("{n} met").replace("{n}", met.toLocaleString("en-US"))}` : "");
}

async function load({ again = false } = {}) {
    const myJob = ++job;
    if (again) {
        shown = [];
        ui.list.innerHTML = `<li class="expressions-loading">${t("loading the expressions…")}</li>`;
    }
    let page;
    try {
        page = await getJson("/api/expressions?" + query());
    } catch (err) {
        if (myJob !== job) return;
        // the very first request may come while the dictionary is still starting
        if (String(err.message).includes("starting") || String(err.message).includes("loading")) {
            ui.list.innerHTML = `<li class="expressions-loading">${t("the dictionary is still starting…")}</li>`;
            setTimeout(() => { if (myJob === job) load({ again }); }, 1500);
            return;
        }
        ui.list.innerHTML = `<li class="expressions-loading">${escapeHtml(err.message)}</li>`;
        return;
    }
    if (myJob !== job) return;
    counts = { sets: page.sets || [], parts: page.parts || [] };
    total = page.total;
    shown = [...shown, ...(page.items || [])];
    renderSets();
    renderCount();
    ui.list.innerHTML = shown.length
        ? shown.map(itemHtml).join("")
        : `<li class="expressions-loading">${t("nothing matches")}</li>`;
    ui.more.hidden = shown.length >= total;
    if (!ui.more.hidden) ui.more.textContent = t("show more");
}

// ---------- the ones you've met ----------

async function renderMet() {
    metMap = store.get(MET, {});
    const keys = metKeys().sort((a, b) => (contextOf(b).at || 0) - (contextOf(a).at || 0));
    if (!keys.length) {
        ui.metList.innerHTML = `<li class="expressions-loading">${t("none yet: idioms akko underlines while you watch and read show up here")}</li>`;
        return;
    }
    // what they mean: from the catalogue when it's here, else the dictionary itself (English too)
    const known = new Map(shown.map((it) => [it.key, it]));
    const missing = keys.filter((k) => !known.has(k));
    const looked = new Map();
    await Promise.all(missing.slice(0, 60).map(async (key) => {
        try {
            const r = await getJson("/api/dict?" + new URLSearchParams({ q: key, lang: target() }));
            const e = r.entries && r.entries[0];
            if (e) looked.set(key, { key, reading: e.reading || "", gloss: e.senses.slice(0, 2).map((s) => s.gloss.join("; ")), sets: [] });
        } catch { /* no dictionary for this one (offline): the date still shows */ }
    }));
    ui.metList.innerHTML = keys.map((key) => itemHtml(known.get(key) || looked.get(key) || { key, reading: "", gloss: [], sets: [] })).join("");
}

// ---------- expression of the day ----------

async function renderToday(attempt = 0) {
    try {
        const { item } = await getJson("/api/expressions/today");
        if (!item) return;
        ui.today.hidden = false;
        ui.today.innerHTML = `<span class="expressions-today-label">${t("expression of the day")}</span>
            <b lang="ja" translate="no">${escapeHtml(item.key)}</b>
            ${item.reading ? `<span class="expression-reading" lang="ja" translate="no">${escapeHtml(item.reading)}</span>` : ""}
            <span class="expression-tags">${tagsOf(item)}</span>
            ${(item.gloss || []).length ? `<ol class="expression-gloss" translate="no"><li>${escapeHtml(item.gloss[0])}</li></ol>` : ""}`;
    } catch {
        if (attempt < 20) setTimeout(() => renderToday(attempt + 1), 1500);
    }
}

// ---------- start ----------

function search() {
    let timer = null;
    ui.search.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => { view.q = ui.search.value.trim(); load({ again: true }); }, 250);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.matches?.("input, textarea, select, [contenteditable], [contenteditable] *")) return;
        e.preventDefault();
        ui.search.focus();
    });
}

function pick(list) {
    list.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-set]");
        if (!b) return;
        if (b.closest("#expressions-parts")) {
            view.part = view.part === b.dataset.set ? "" : b.dataset.set;
            view.set = "all";                 // a body part is a set of its own
        } else {
            view.set = b.dataset.set;
            view.part = "";
        }
        load({ again: true });
    });
}

// met in this or another tab since the page loaded (mining, the popup, a sync): show it
function watchMet() {
    window.addEventListener("storage", (e) => {
        if (e.key !== MET && e.key !== null) return;
        metMap = store.get(MET, {});
        renderCount();
        renderMet();
    });
}

async function start() {
    metMap = store.get(MET, {});
    mined = await loadMined().catch(() => []);
    watchMet();
    search();
    pick(ui.sets);
    pick(ui.parts);
    ui.more.addEventListener("click", () => load());
    if (en()) {
        // the sets come from JMdict: Japanese only. What you've met is still here, looked up in
        // the English dictionary.
        ui.browse.hidden = true;
        renderMet();
        return;
    }
    renderToday();
    await load({ again: true });
    renderMet();               // with the catalogue's meanings for the met ones
}

start();
