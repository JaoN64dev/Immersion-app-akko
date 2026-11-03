// One coverage engine (3.0). Every "how much of this do I know" number in akko comes from here: the
// % on a video, a podcast, a manga or a text, the words worth learning before you start it, and
// what that learning would buy you. Before this each page summed its own, which is why the same
// text could show two different numbers.
//
// The input is what /api/tokenize gives (scripts/words/render.js): one array of tokens per line,
// each {s: surface, b: dictionary form, c: counts as a word, n: name …}. Ignored words (sound
// effects, names you marked ignored) never count; a word that is "known" counts as known; anything
// else is unknown, including the ones marked "learning" — a number that goes down when you forget
// something is a number you can trust.

import { wordStatus } from "../words/status.js";

// the tokens worth counting at all
const counted = (t) => !!(t && t.c && t.b);

// The whole picture for these lines.
// -> {total, known, pct, unknown: Map(word -> times it appears), iPlus1: lines with one unknown
//     word left, lines: how many lines}
export function coverage(lines, { status = wordStatus } = {}) {
    const unknown = new Map();
    let total = 0;
    let known = 0;
    let iPlus1 = 0;
    for (const tokens of lines) {
        const unknownHere = new Set();
        for (const t of tokens || []) {
            if (!counted(t)) continue;
            const s = status(t.b);
            if (s === "ignored") continue;
            total++;
            if (s === "known") known++;
            else {
                unknown.set(t.b, (unknown.get(t.b) || 0) + 1);
                unknownHere.add(t.b);
            }
        }
        if (unknownHere.size === 1) iPlus1++;
    }
    return { total, known, pct: total ? Math.round((known / total) * 100) : 0, unknown, iPlus1, lines: lines.length };
}

// The shape the badges have always taken ({unknown} is a count here, not the map)
export const comprehension = (lines) => {
    const c = coverage(lines);
    return { pct: c.pct, total: c.total, known: c.known, unknown: c.unknown.size, iPlus1: c.iPlus1 };
};

// content words in a line you don't know yet
export const unknownIn = (tokens) => new Set((tokens || []).filter((t) => counted(t) && wordStatus(t.b) !== "known" && wordStatus(t.b) !== "ignored").map((t) => t.b));

// Priming: what to learn before you read this. A word that would leave a line with no unknown
// words at all (i+1) is worth more than one that merely shows up a lot, so that comes first, then
// how often it appears. -> [{word, sample, count, unlocks}]
export function prime(lines, { limit = 10, status = wordStatus } = {}) {
    const byWord = new Map();
    for (const tokens of lines) {
        const unknownHere = new Set();
        for (const t of tokens || []) {
            if (!counted(t)) continue;
            const s = status(t.b);
            if (s === "known" || s === "ignored") continue;
            unknownHere.add(t.b);
            const seen = byWord.get(t.b) || { word: t.b, sample: t.s || t.b, count: 0, unlocks: 0 };
            seen.count++;
            byWord.set(t.b, seen);
        }
        if (unknownHere.size === 1) {
            const seen = byWord.get([...unknownHere][0]);
            if (seen) seen.unlocks++;
        }
    }
    return [...byWord.values()]
        .sort((a, b) => b.unlocks - a.unlocks || b.count - a.count || a.word.localeCompare(b.word))
        .slice(0, limit);
}

// how much of these lines you would know if `words` were known — the number the priming list adds up to
export function coverageIfKnown(lines, words, { status = wordStatus } = {}) {
    const wouldKnow = words instanceof Set ? words : new Set(words);
    return coverage(lines, { status: (w) => (wouldKnow.has(w) ? "known" : status(w)) });
}
