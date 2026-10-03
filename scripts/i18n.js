// English / 日本語 switch for the site's interface (saved in "akko-settings" as lang).
//
// The pages and scripts are written in English. In Japanese mode, every piece of text and every
// title / placeholder / aria-label that has an entry in scripts/lang/ja.js is swapped for its
// translation, including text the scripts add later (a MutationObserver watches the page).
// Elements with data-i18n="key" are swapped as a whole, from the html section of ja.js.
//
// Content is never touched: anything inside an element with its own lang="…" (subtitles, books,
// titles) or translate="no" (dictionary meanings, lesson text) stays as it is.

import { store } from "./core/utils.js";
import ja from "./lang/ja.js";

const KEY = "akko-settings";
const ATTRS = ["title", "placeholder", "aria-label"];

export const lang = () => (store.get(KEY, {}).lang === "ja" ? "ja" : "en");

// ---------- the dictionary ----------

const norm = (s) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exact = new Map();
const patterns = [];           // "{n} unknown words" -> /^(.+?) unknown words$/
for (const [en, jp] of Object.entries(ja.text)) {
    const key = norm(en);
    if (!/\{\w+\}/.test(key)) { exact.set(key, jp); continue; }
    const names = [];
    const re = key.split(/(\{\w+\})/).map((part) => {
        const m = part.match(/^\{(\w+)\}$/);
        if (!m) return escapeRe(part);
        names.push(m[1]);
        return "(.+?)";
    }).join("");
    patterns.push({ re: new RegExp(`^${re}$`, "s"), names, jp });
}

// Japanese for one string, or undefined if there's no entry
function lookup(text) {
    const key = norm(text);
    if (!key) return undefined;
    if (exact.has(key)) return exact.get(key);
    for (const p of patterns) {
        const m = key.match(p.re);
        if (m) return p.jp.replace(/\{(\w+)\}/g, (all, name) => (p.names.includes(name) ? m[p.names.indexOf(name) + 1] : all));
    }
    return undefined;
}

// For scripts (confirm() boxes etc.): the text in the current language
export const t = (text) => (lang() === "ja" ? lookup(text) ?? text : text);

// ---------- swapping text in the page ----------

const originals = new WeakMap();      // text node -> English, element -> {attr: English, html: English}
let observer = null;

const skipped = (el) => !el || !!el.closest("[translate=no], script, style, textarea, [contenteditable=true]")
    || el.closest("[lang]") !== document.documentElement;

// keep the spaces around the text (they separate it from the <kbd> or <b> next to it)
const keepSpaces = (original, jp) => original.match(/^\s*/)[0] + jp + original.match(/\s*$/)[0];

function swapText(node, toJa) {
    let en = originals.get(node);
    if (en === undefined) {
        if (!toJa) return;
        en = node.data;
        originals.set(node, en);
    }
    const jp = toJa ? lookup(en) : undefined;
    const want = jp === undefined ? en : keepSpaces(en, jp);
    if (node.data !== want) node.data = want;
}

function swapElement(el, toJa) {
    let saved = originals.get(el);
    if (!saved) {
        if (!toJa) return;
        saved = {};
        originals.set(el, saved);
    }
    for (const attr of ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        if (!(attr in saved)) saved[attr] = el.getAttribute(attr);
        const jp = toJa ? lookup(saved[attr]) : undefined;
        const want = jp === undefined ? saved[attr] : jp;
        if (el.getAttribute(attr) !== want) el.setAttribute(attr, want);
    }
    const key = el.dataset.i18n;
    if (key && ja.html[key] !== undefined) {
        if (!("html" in saved)) saved.html = el.innerHTML;
        const want = toJa ? ja.html[key] : saved.html;
        if (el.innerHTML !== want) el.innerHTML = want;
        return true;           // its children are done
    }
    return false;
}

// Translate (or put back) everything inside root
function apply(root, toJa = lang() === "ja") {
    if (root.nodeType === Node.TEXT_NODE) {
        if (!skipped(root.parentElement)) swapText(root, toJa);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || skipped(root)) return;
    if (swapElement(root, toJa)) return;
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
        if (n.nodeType === Node.TEXT_NODE) swapText(n, toJa);
        else if (swapElement(n, toJa)) done.add(n);
    }
}

// New text from the scripts is English: remember it as the original, then translate it
function watch() {
    observer = new MutationObserver((records) => {
        const toJa = lang() === "ja";
        for (const r of records) {
            // a script changed this text: what we remembered as the English is out of date
            if (r.type === "characterData") originals.delete(r.target);
            if (r.type === "attributes") { const saved = originals.get(r.target); if (saved) delete saved[r.attributeName]; }
            if (!toJa) continue;
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
    apply(document.body, l === "ja");
    if (observer) observer.takeRecords();
    // the switch on the settings page
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === l)));
}

show();
watch();
// another tab switched language
window.addEventListener("storage", (e) => { if (e.key === KEY && document.documentElement.lang !== lang()) show(); });
