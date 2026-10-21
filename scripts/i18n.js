// The language of the site's interface: English, 日本語, Português or Español (saved in
// "akko-settings" as lang; until one is picked, "your language" from Settings or the browser's,
// when there's a table for it).
//
// The pages and scripts are written in English. In another language, every piece of text and every
// title / placeholder / aria-label that has an entry in its table (scripts/lang/ja.js, pt.js, es.js)
// is swapped for its translation, including text the scripts add later (a MutationObserver watches
// the page). Elements with data-i18n="key" are swapped as a whole, from the table's html section.
//
// Content is never touched: anything inside an element with its own lang="…" (subtitles, books,
// titles) or translate="no" (dictionary meanings, lesson text) stays as it is.

import { store } from "./core/utils.js";
import { nativeLang } from "./core/target.js";
import ja from "./lang/ja.js";
import pt from "./lang/pt.js";
import es from "./lang/es.js";

const KEY = "akko-settings";
const ATTRS = ["title", "placeholder", "aria-label"];
const TABLES = { ja, pt, es };
export const LANGUAGES = { en: "English", ja: "日本語", pt: "Português", es: "Español" };

export function lang() {
    const saved = store.get(KEY, {}).lang;
    if (saved) return TABLES[saved] ? saved : "en";
    const native = nativeLang();
    return TABLES[native] ? native : "en";
}

// ---------- the dictionary (of the language shown, built when first needed) ----------

const norm = (s) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let built = null;              // {lang, exact, patterns}
function dictionary() {
    const l = lang();
    if (built && built.lang === l) return built;
    const exact = new Map();
    const patterns = [];       // "{n} unknown words" -> /^(.+?) unknown words$/
    for (const [en, tr] of Object.entries((TABLES[l] || { text: {} }).text)) {
        const key = norm(en);
        if (!/\{\w+\}/.test(key)) { exact.set(key, tr); continue; }
        const names = [];
        const re = key.split(/(\{\w+\})/).map((part) => {
            const m = part.match(/^\{(\w+)\}$/);
            if (!m) return escapeRe(part);
            names.push(m[1]);
            return "(.+?)";
        }).join("");
        patterns.push({ re: new RegExp(`^${re}$`, "s"), names, tr });
    }
    built = { lang: l, exact, patterns, html: (TABLES[l] || {}).html || {} };
    return built;
}

// the translation of one string, or undefined if there's no entry
function lookup(text) {
    const key = norm(text);
    if (!key) return undefined;
    const { exact, patterns } = dictionary();
    if (exact.has(key)) return exact.get(key);
    for (const p of patterns) {
        const m = key.match(p.re);
        if (m) return p.tr.replace(/\{(\w+)\}/g, (all, name) => (p.names.includes(name) ? m[p.names.indexOf(name) + 1] : all));
    }
    return undefined;
}

// For scripts (confirm() boxes etc.): the text in the current language
export const t = (text) => (lang() !== "en" ? lookup(text) ?? text : text);

// ---------- swapping text in the page ----------

const originals = new WeakMap();      // text node -> English, element -> {attr: English, html: English}
let observer = null;

const skipped = (el) => !el || !!el.closest("[translate=no], script, style, textarea, [contenteditable=true]")
    || el.closest("[lang]") !== document.documentElement;

// keep the spaces around the text (they separate it from the <kbd> or <b> next to it)
const keepSpaces = (original, tr) => original.match(/^\s*/)[0] + tr + original.match(/\s*$/)[0];

function swapText(node, on) {
    let en = originals.get(node);
    if (en === undefined) {
        if (!on) return;
        en = node.data;
        originals.set(node, en);
    }
    const tr = on ? lookup(en) : undefined;
    const want = tr === undefined ? en : keepSpaces(en, tr);
    if (node.data !== want) node.data = want;
}

function swapElement(el, on) {
    let saved = originals.get(el);
    if (!saved) {
        if (!on) return;
        saved = {};
        originals.set(el, saved);
    }
    for (const attr of ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        if (!(attr in saved)) saved[attr] = el.getAttribute(attr);
        const tr = on ? lookup(saved[attr]) : undefined;
        const want = tr === undefined ? saved[attr] : tr;
        if (el.getAttribute(attr) !== want) el.setAttribute(attr, want);
    }
    const key = el.dataset.i18n;
    const html = dictionary().html;
    if (key && (html[key] !== undefined || "html" in saved)) {
        if (!("html" in saved)) saved.html = el.innerHTML;
        const want = on && html[key] !== undefined ? html[key] : saved.html;
        if (el.innerHTML !== want) el.innerHTML = want;
        return true;           // its children are done
    }
    return false;
}

// Translate (or put back) everything inside root
function apply(root, on = lang() !== "en") {
    if (root.nodeType === Node.TEXT_NODE) {
        if (!skipped(root.parentElement)) swapText(root, on);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || skipped(root)) return;
    if (swapElement(root, on)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
            if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
            if (n.matches("[translate=no], script, style, textarea") || (n.hasAttribute("lang"))) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const done = new Set();          // data-i18n elements: skip what's inside them
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ([...done].some((d) => d.contains(n))) continue;
        if (n.nodeType === Node.TEXT_NODE) swapText(n, on);
        else if (swapElement(n, on)) done.add(n);
    }
}

// New text from the scripts is English: remember it as the original, then translate it
function watch() {
    observer = new MutationObserver((records) => {
        const on = lang() !== "en";
        for (const r of records) {
            // a script changed this text: what we remembered as the English is out of date
            if (r.type === "characterData") originals.delete(r.target);
            if (r.type === "attributes") { const saved = originals.get(r.target); if (saved) delete saved[r.attributeName]; }
            if (!on) continue;
            if (r.type === "childList") r.addedNodes.forEach((n) => apply(n, true));
            else if (r.type === "characterData") apply(r.target, true);
            else if (r.type === "attributes" && !skipped(r.target)) swapElement(r.target, true);
        }
        observer.takeRecords();      // our own changes above
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

export function setLang(l) {
    store.set(KEY, { ...store.get(KEY, {}), lang: l });
    show();
}

function show() {
    const l = lang();
    document.documentElement.lang = l;
    // from one language to another: back to the English first, then the new one
    apply(document.body, false);
    if (l !== "en") apply(document.body, true);
    if (observer) observer.takeRecords();
    // the switch on the settings page
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === l)));
}

show();
watch();
// another tab switched language
window.addEventListener("storage", (e) => { if (e.key === KEY && document.documentElement.lang !== lang()) show(); });
