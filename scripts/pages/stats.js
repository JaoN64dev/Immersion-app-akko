// 統計 Stats, on the settings page (settings.html): rough totals pulled from what's already saved
// in this browser for the language being learnt — word knowledge, mining, watch/read/listen.
// Read-only: nothing here is fetched from the server or sent anywhere.

import { escapeHtml } from "../core/utils.js";
import { target, learningEnglish } from "../core/target.js";
import { wordStats, watchStats, mangaStats, podcastStats, textStats, minedStats, grammarStats } from "../totals.js";

// ---------- small formatters ----------

const compact = (n) => (
    n >= 1e6 ? (n / 1e6).toFixed(1) + "M" :
    n >= 1e4 ? Math.round(n / 1e3) + "K" :
    n >= 1e3 ? (n / 1e3).toFixed(1) + "K" :
    n.toLocaleString()
);

function hoursText(seconds) {
    if (!seconds) return "0 min";
    const h = seconds / 3600;
    return h >= 1 ? `${h.toFixed(1)} h` : `${Math.max(1, Math.round(seconds / 60))} min`;
}

function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
    if (s < 31536000) return `${Math.floor(s / 2592000)}mo ago`;
    return `${Math.floor(s / 31536000)}y ago`;
}

// ---------- rendering ----------

function tile(value, label, sub) {
    return `<div class="note stats-note stat-tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</div>`;
}

function renderTiles({ words, watch, manga, podcast, text, mined, grammar }) {
    document.getElementById("stats-tiles").innerHTML = [
        tile(compact(words.known), "words known"),
        tile(compact(words.learning), "words learning"),
        tile(compact(mined.count), "words mined", mined.anki ? `${mined.anki} sent to Anki` : ""),
        tile(compact(text.chars), "characters read", text.count ? `${text.count} texts` : ""),
        learningEnglish() ? "" : tile(compact(manga.pages), "manga pages read", manga.count ? `${manga.count} volumes` : ""),     // manga is Japanese only
        tile(compact(watch.count), "videos in progress", watch.finished ? `${watch.finished} finished` : ""),
        tile(hoursText(watch.seconds), "time watching"),
        tile(hoursText(podcast.seconds), "time listening", podcast.count ? `${podcast.done} / ${podcast.count} episodes done` : ""),
        tile(compact(grammar.learned), "grammar lessons learned", grammar.passed ? `${grammar.passed} quizzes passed` : ""),
    ].join("");
}

// A single segmented bar (known/learning/ignored): counts are always shown directly in the
// legend, so the bar's low-contrast fills (yellow especially) never have to carry meaning alone.
function renderWordBar(words) {
    const el = document.getElementById("stats-words");
    const total = words.known + words.learning + words.ignored;
    if (!total) {
        el.innerHTML = `<p class="stats-empty">no words tracked yet — click a word on any page and set its status (keys 1-4).</p>`;
        return;
    }
    const segs = [
        { label: "known", n: words.known, color: "#0ca30c" },
        { label: "learning", n: words.learning, color: "#fab219" },
        { label: "ignored", n: words.ignored, color: "#8E8D98" },
    ];
    el.innerHTML = `
        <div class="stats-bar" role="img" aria-label="${escapeHtml(segs.map((s) => `${s.n} ${s.label}`).join(", "))}">
            ${segs.filter((s) => s.n > 0).map((s) =>
                `<i style="width:${((s.n / total) * 100).toFixed(2)}%;background:${s.color}" title="${s.label}: ${s.n}"></i>`).join("")}
        </div>
        <ul class="stats-legend">
            ${segs.map((s) => `<li><i style="background:${s.color}"></i>${s.label} <b>${s.n.toLocaleString()}</b></li>`).join("")}
        </ul>`;
}

// Bars per day, last `days` days. Single series (mark spec: <=24px thick, 4px rounded top,
// baseline; a hover/focus tooltip on every bar since a value that small can't be direct-labeled).
function miningByDay(items, days = 30) {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
    const buckets = new Map();
    for (let i = 0; i < days; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        buckets.set(d.toDateString(), { date: d, count: 0 });
    }
    items.forEach((m) => {
        const d = new Date(m.added); d.setHours(0, 0, 0, 0);
        const b = buckets.get(d.toDateString());
        if (b) b.count++;
    });
    return [...buckets.values()];
}

function renderMiningChart(items) {
    const el = document.getElementById("stats-mining");
    const data = miningByDay(items);
    if (!items.length) {
        el.innerHTML = `<p class="stats-empty">nothing mined yet — click a word's dictionary entry and hit "+ mine".</p>`;
        return;
    }
    const w = 600, h = 140, padB = 18, padT = 10;
    const max = Math.max(1, ...data.map((d) => d.count));
    const chartH = h - padB - padT;
    const slot = w / data.length;
    const barW = Math.min(24, slot - 2);

    const bars = data.map((d, i) => {
        const bh = d.count ? Math.max(2, (d.count / max) * chartH) : 0;
        const x = i * slot + (slot - barW) / 2;
        const y = padT + (chartH - bh);
        return `<rect class="mining-bar" tabindex="0" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" ry="4"></rect>`;
    }).join("");

    el.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" class="mining-svg" role="img" aria-label="words mined per day, last ${data.length} days">
            <line x1="0" y1="${h - padB}" x2="${w}" y2="${h - padB}" class="mining-baseline"></line>
            ${bars}
        </svg>
        <div class="stats-tooltip" hidden></div>`;

    const tooltip = el.querySelector(".stats-tooltip");
    el.querySelectorAll(".mining-bar").forEach((rect, i) => {
        const d = data[i];
        const show = () => {
            tooltip.hidden = false;
            tooltip.textContent = "";
            const strong = document.createElement("strong");
            strong.textContent = String(d.count);
            tooltip.append(strong, document.createTextNode(
                ` mined · ${d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`));
            const scale = el.clientWidth / w;
            const cx = (parseFloat(rect.getAttribute("x")) + parseFloat(rect.getAttribute("width")) / 2) * scale;
            const cy = parseFloat(rect.getAttribute("y")) * scale;
            tooltip.style.left = cx + "px";
            tooltip.style.top = cy + "px";
            rect.classList.add("hover");
        };
        const hide = () => { tooltip.hidden = true; rect.classList.remove("hover"); };
        rect.addEventListener("pointerenter", show);
        rect.addEventListener("pointermove", show);
        rect.addEventListener("pointerleave", hide);
        rect.addEventListener("focus", show);
        rect.addEventListener("blur", hide);
    });
}

const TYPE_INFO = {
    watch: { label: "watch", color: "var(--extra2)" },
    manga: { label: "manga", color: "var(--extra4)" },
    read: { label: "read", color: "var(--extra6)" },
};

function renderRecent(rows) {
    const el = document.getElementById("stats-recent");
    const items = rows.filter((r) => r.title && r.when).sort((a, b) => b.when - a.when).slice(0, 12);
    if (!items.length) {
        el.innerHTML = `<li class="stats-empty">nothing yet — go watch, read or listen to something!</li>`;
        return;
    }
    el.innerHTML = items.map((r) => {
        const t = TYPE_INFO[r.type];
        return `<li class="note stats-note">
            <span class="chip" style="background:${t.color}">${t.label}</span>
            <span class="stats-title" lang="${target()}">${escapeHtml(r.title)}</span>
            ${r.extra ? `<span class="stats-extra">${escapeHtml(r.extra)}</span>` : ""}
            <span class="stats-when">${timeAgo(r.when)}</span>
        </li>`;
    }).join("");
}

async function init() {
    const words = wordStats();
    const watch = watchStats();
    const manga = mangaStats();
    const podcast = podcastStats();
    const grammar = grammarStats();
    const [text, mined] = await Promise.all([textStats(), minedStats()]);

    renderTiles({ words, watch, manga, podcast, text, mined, grammar });
    renderWordBar(words);
    renderMiningChart(mined.items);
    renderRecent([...watch.recent, ...manga.recent, ...text.recent]);
}

init();
