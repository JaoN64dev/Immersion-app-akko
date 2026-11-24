// Stats 2.0, the two numbers the plan still lacked (docs/ideas-3.0.md, phase 3):
//   - retention by source: of the words you mined from videos, manga, texts…, how many 復習
//     reviews you passed, and how likely you are to remember them today (FSRS, scripts/words/fsrs.js)
//   - time to the next level: words known, the next milestone, and when you'd get there at the
//     pace of the last 30 days. The pace needs a history, so once a day the count of known words is
//     written down ("akko-known-days" / -en…: {"2026-11-24": 1234}).
// The calculations are pure (tests/levels.test.mjs); only snapshot() touches storage.

import { store } from "./utils.js";
import { keyFor } from "./target.js";
import { dayOf } from "./today.js";
import { retrievability } from "../words/fsrs.js";

const DAY = 864e5;
const KEEP_DAYS = 400;

// ---------- retention by source ----------

export const SOURCE_KINDS = {
    watch: "videos", manga: "manga", read: "texts", web: "web pages", listen: "podcasts",
    grammar: "grammar lessons", listening: "listening practice", other: "elsewhere",
};

// What a mined word came from. Words mined from now on say it (`kind`); older ones are recognised
// by what their page used to save.
export function sourceKind(m) {
    if (m.kind && SOURCE_KINDS[m.kind]) return m.kind;
    if (m.videoName || (m.cueStart !== null && m.cueStart !== undefined)) return "watch";
    if (m.url) return "web";
    const source = String(m.source || "");
    if (source.startsWith("文法 ")) return "grammar";
    if (source.startsWith("聴解")) return "listening";
    if (/ p\.\d+$/.test(source)) return "manga";
    if (m.time) return "listen";                 // a podcast saves a time but no video
    return source ? "read" : "other";
}

// mined: the mined words; cards: {lemma: {s, d, due, last, reps, lapses}} (復習).
// -> [{kind, label, words, reviewed, reps, passed (0-1), recall (0-1, today)}], most words first;
//    only sources with at least one reviewed word.
export function retentionBySource(mined, cards, now = Date.now()) {
    const byKind = new Map();
    const seen = new Set();
    for (const m of mined) {
        const lemma = m.word;
        if (!lemma || seen.has(lemma)) continue;          // a word mined twice counts once, for its first source
        seen.add(lemma);
        const kind = sourceKind(m);
        if (!byKind.has(kind)) byKind.set(kind, { kind, label: SOURCE_KINDS[kind], words: 0, reviewed: 0, reps: 0, lapses: 0, recallSum: 0 });
        const k = byKind.get(kind);
        k.words++;
        const card = cards[lemma];
        if (!card || !card.s || !card.reps) continue;
        k.reviewed++;
        k.reps += card.reps;
        k.lapses += card.lapses || 0;
        k.recallSum += retrievability(Math.max(0, (now - (card.last || now)) / DAY), card.s);
    }
    return [...byKind.values()]
        .filter((k) => k.reviewed)
        .map(({ recallSum, lapses, ...k }) => ({
            ...k,
            passed: Math.max(0, (k.reps - lapses) / k.reps),
            recall: recallSum / k.reviewed,
        }))
        .sort((a, b) => b.words - a.words);
}

// ---------- time to the next level ----------

export const MILESTONES = [100, 250, 500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000];

const known = (words) => Object.values(words || {}).filter((s) => s === "known").length;

// Once a day: today's count of known words. Returns the history.
export function snapshot(now = new Date()) {
    const key = keyFor("akko-known-days");
    const days = store.get(key, {});
    const today = dayOf(now);
    const n = known(store.get(keyFor("akko-words"), {}));
    if (days[today] === n) return days;
    days[today] = n;
    const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
    const trimmed = Object.fromEntries(keep.map((d) => [d, days[d]]));
    store.set(key, trimmed);
    return trimmed;
}

// history {day: known}, today's count -> {known, next, left, perDay, days, since}
//   perDay: words per day over the last 30 days of history (null until there are 7 days of it)
//   days: days to the next milestone at that pace (null when there's no pace, or it isn't going up)
export function nextLevel(history, knownNow, today = dayOf()) {
    const next = MILESTONES.find((m) => m > knownNow) || null;
    const out = { known: knownNow, next, left: next ? next - knownNow : 0, perDay: null, days: null, since: null };
    const t = Date.parse(today);
    const window = Object.entries(history || {})
        .map(([d, n]) => [Date.parse(d), n])
        .filter(([d, n]) => Number.isFinite(d) && Number.isFinite(n) && d <= t && t - d <= 30 * DAY)
        .sort((a, b) => a[0] - b[0]);
    if (!window.length) return out;
    const span = (t - window[0][0]) / DAY;
    if (span < 7) return out;
    out.since = new Date(window[0][0]).toISOString().slice(0, 10);
    out.perDay = (knownNow - window[0][1]) / span;
    if (next && out.perDay > 0) out.days = Math.ceil(out.left / out.perDay);
    return out;
}
