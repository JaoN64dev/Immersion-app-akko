// Turning files into {title, paragraphs}: .txt, .html/.xhtml, .epub, subtitles

import { loadScript } from "../core/utils.js";
import { parseSubtitle } from "../subtitles/parse.js";

const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

export async function getJSZip() {
    await loadScript(JSZIP);
    return window.JSZip;
}

export const splitParagraphs = (text) => text.replace(/\r/g, "").split(/\n+/).map((s) => s.trim()).filter(Boolean);

const baseName = (name) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");

// Japanese text files are UTF-8 or Shift-JIS
function decode(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
    catch { return new TextDecoder("shift_jis").decode(buf); }
}

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,dt,dd,pre,td";

// A web page's chrome, dropped before taking its text (読む → from a URL)
const PAGE_NOISE = "header, footer, aside, form, button, [role=banner], [role=complementary], [role=navigation], .ad, .ads, .advertisement, .cookie, .modal, .popup, .sidebar, .menu, .share, .social, .comment, .comments";
const MAIN = "article, main, [role=main]";

// Paragraphs from an (x)html document; furigana (<rt>) is dropped, the site adds its own.
// webPage: a page off the web rather than a book's chapter, so its header/sidebars/ads go and the
// article (if it marks one) is all that's read.
export function htmlParagraphs(markup, xml = false, { webPage = false } = {}) {
    let doc = new DOMParser().parseFromString(markup, xml ? "application/xhtml+xml" : "text/html");
    if (xml && doc.querySelector("parsererror")) doc = new DOMParser().parseFromString(markup, "text/html");
    let body = doc.body || doc.documentElement;
    body.querySelectorAll("rt, rp, script, style, nav, noscript, template").forEach((n) => n.remove());
    if (webPage) {
        body.querySelectorAll(PAGE_NOISE).forEach((n) => n.remove());
        body = body.querySelector(MAIN) || body;
    }
    body.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    // innermost blocks only, so a <li><p> isn't counted twice
    const blocks = [...body.querySelectorAll(BLOCKS)].filter((b) => !b.querySelector(BLOCKS));
    const inBlocks = blocks.reduce((n, b) => n + b.textContent.trim().length, 0);
    // A page written as one <div> with <br>s between the lines (Aozora Bunko, many novel sites) has
    // only its title and author in blocks: taking just those would drop the whole story.
    const all = body.textContent.replace(/\s+/g, "").length;
    if (blocks.length && inBlocks >= all * 0.5) return blocks.map((b) => b.textContent).flatMap(splitParagraphs);
    // the whole text, each block on its own line so a heading doesn't run into the first sentence
    body.querySelectorAll(`${BLOCKS},div,section`).forEach((b) => b.after("\n"));
    const texts = [body.textContent];
    return texts.flatMap(splitParagraphs);
}

// <title>, with its entities decoded (&amp; → &)
export const htmlTitle = (markup) => new DOMParser().parseFromString(markup, "text/html").title.trim();

// epub = zip: META-INF/container.xml -> the .opf -> spine order of xhtml files
async function epub(buf) {
    const JSZip = await getJSZip();
    const zip = await JSZip.loadAsync(buf);
    const xml = async (path) => new DOMParser().parseFromString(await zip.file(path).async("string"), "application/xml");

    const container = await xml("META-INF/container.xml");
    const opfPath = container.querySelector("rootfile").getAttribute("full-path");
    const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const opf = await xml(opfPath);

    const title = opf.getElementsByTagNameNS("*", "title")[0]?.textContent.trim();
    const manifest = Object.fromEntries([...opf.getElementsByTagNameNS("*", "item")]
        .map((i) => [i.getAttribute("id"), i.getAttribute("href")]));
    const chapters = [...opf.getElementsByTagNameNS("*", "itemref")]
        .map((r) => manifest[r.getAttribute("idref")])
        .filter(Boolean)
        .map((href) => decodeURIComponent(dir + href.split("#")[0]));

    const paragraphs = [];
    for (const path of chapters) {
        const f = zip.file(path);
        if (f) paragraphs.push(...htmlParagraphs(await f.async("string"), true));
    }
    return { title, paragraphs };
}

export async function readTextFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const buf = await file.arrayBuffer();
    let title = baseName(file.name);
    let paragraphs;

    if (ext === "epub") {
        const book = await epub(buf);
        title = book.title || title;
        paragraphs = book.paragraphs;
    } else if (["html", "htm", "xhtml"].includes(ext)) {
        paragraphs = htmlParagraphs(decode(buf), ext === "xhtml");
    } else if (["srt", "ass", "ssa", "vtt"].includes(ext)) {
        paragraphs = parseSubtitle(decode(buf), ext).map((c) => c.text.replace(/\n/g, " "));
    } else {
        paragraphs = splitParagraphs(decode(buf));
    }
    if (!paragraphs.length) throw new Error("couldn't find any text in that file");
    return { title, paragraphs };
}
