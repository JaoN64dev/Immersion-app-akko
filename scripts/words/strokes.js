// Stroke order (3.0, feature 11, the stroke-order half): a kanji drawn stroke by stroke, with the
// stroke numbers, from KanjiVG (Ulrich Apel, CC BY-SA 3.0, https://kanjivg.tagaini.net). The SVG
// for a kanji is fetched once from a pinned KanjiVG release and kept for the session. Only the
// path data and the numbers' positions are taken from it: the picture is drawn by akko, so nothing
// from the file ever runs or styles the page.

import { t } from "../i18n.js";

const KANJIVG = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@r20250816/kanji/";
const NS = "http://www.w3.org/2000/svg";
const STROKE_MS = 380;           // how long one stroke takes to draw
const cache = new Map();         // kanji -> Promise<{strokes: [d], numbers: [{n, x, y}]}>

const fileOf = (ch) => ch.codePointAt(0).toString(16).padStart(5, "0") + ".svg";

// KanjiVG's SVG -> the strokes in order and where their numbers go
export function parseKanjiVG(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const order = (id) => Number((String(id || "").match(/-s(\d+)$/) || [])[1] || 0);
    const strokes = [...doc.getElementsByTagName("path")]
        .filter((p) => p.getAttribute("d"))
        .sort((a, b) => order(a.getAttribute("id")) - order(b.getAttribute("id")))
        .map((p) => p.getAttribute("d"))
        .filter((d) => /^[MmLlCcSsQqTtAaZzHhVv0-9.,\s-]+$/.test(d));      // path data and nothing else
    const numbers = [...doc.getElementsByTagName("text")].map((t) => {
        const m = /matrix\(\s*1\s+0\s+0\s+1\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(t.getAttribute("transform") || "");
        const n = Number(t.textContent);
        return m && n ? { n, x: Number(m[1]), y: Number(m[2]) } : null;
    }).filter(Boolean);
    return { strokes, numbers };
}

function load(ch) {
    if (!cache.has(ch)) {
        cache.set(ch, fetch(KANJIVG + fileOf(ch))
            .then((r) => { if (!r.ok) throw new Error("KanjiVG has no stroke order for " + ch); return r.text(); })
            .then(parseKanjiVG)
            .catch((err) => { cache.delete(ch); throw err; }));       // try again next time (offline…)
    }
    return cache.get(ch);
}

function draw(box, { strokes, numbers }) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 109 109");
    svg.setAttribute("class", "strokes-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${strokes.length} strokes`);
    const paths = strokes.map((d) => {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        svg.append(p);
        return p;
    });
    for (const { n, x, y } of numbers) {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("x", String(x));
        t.setAttribute("y", String(y));
        t.textContent = String(n);
        svg.append(t);
    }
    box.replaceChildren(svg);
    // each stroke appears in turn, drawn from its start to its end
    paths.forEach((p, i) => {
        const len = p.getTotalLength ? p.getTotalLength() : 100;
        p.style.strokeDasharray = String(len);
        if (p.animate) {
            p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
                { duration: STROKE_MS, delay: i * (STROKE_MS + 60), fill: "both", easing: "ease-in-out" });
        }
    });
}

// Show the stroke order of `ch` in `box` (again, if it's already there: it replays)
export async function showStrokes(box, ch) {
    box.hidden = false;
    box.textContent = "…";
    try {
        draw(box, await load(ch));
    } catch (err) {
        box.textContent = err.message.startsWith("KanjiVG") ? err.message : t("stroke order needs the internet the first time");
    }
}
