// Rough totals of what you've done, from what's saved in this browser: words, watching,
// manga, podcasts, texts, mined words, grammar, for the language being learnt.
// Used by the stats (settings) and course pages.

import { store } from "./core/utils.js";
import { idbAll } from "./core/idb.js";
import { KEY as PROGRESS_KEY } from "./progress.js";
import { PROGRESS_KEY as GRAMMAR_KEY } from "./grammar/lessons.js";
import { keyFor, ofTarget, learningEnglish, understood } from "./core/target.js";
import { readingOf } from "./reader/library.js";

const MANGA_KEY = "akko-manga";             // manga is Japanese only
const POD_KEY = keyFor("akko-podcast-progress");
const WORDS_KEY = keyFor("akko-words");

export function wordStats() {
    const words = store.get(WORDS_KEY, {});
    const c = { known: 0, learning: 0, ignored: 0 };
    Object.values(words).forEach((s) => { c[s] = (c[s] || 0) + 1; });
    return c;
}

export function watchStats() {
    const all = Object.values(store.get(PROGRESS_KEY, {}));
    const seconds = all.reduce((n, r) => n + (r.time || 0), 0);
    const finished = all.filter((r) => r.duration && r.time / r.duration > 0.9).length;
    const recent = all.map((r) => ({
        type: "watch", title: (r.anime && (r.anime.title.native || r.anime.title.romaji)) || r.videoName || "video",
        extra: r.duration ? `${Math.round((r.time / r.duration) * 100)}%` : "", when: r.updated,
    }));
    return { count: all.length, finished, seconds, recent };
}

export function mangaStats() {
    const all = learningEnglish() ? [] : Object.values(store.get(MANGA_KEY, {}));
    const pages = all.reduce((n, r) => n + (r.page || 0) + 1, 0);
    const recent = all.map((r) => ({
        type: "manga", title: r.title, extra: `page ${r.page + 1} / ${r.total}`, when: r.updated,
    }));
    return { count: all.length, pages, recent };
}

export function podcastStats() {
    const all = Object.values(store.get(POD_KEY, {}));
    const seconds = all.reduce((n, r) => n + (r.time || 0), 0);
    const done = all.filter((r) => r.done).length;
    // episodes only store a guid, not a title, so they can't join the recent-activity list
    return { count: all.length, done, seconds };
}

export async function textStats() {
    const texts = (await idbAll("texts").catch(() => [])).filter(ofTarget);
    const chars = texts.reduce((n, t) => {
        const frac = t.paragraphs && t.paragraphs.length > 1 ? Math.min(1, readingOf(t).position / (t.paragraphs.length - 1)) : 1;
        return n + Math.round((t.chars || 0) * frac);
    }, 0);
    const recent = texts.map((t) => {
        const { pct, updated } = readingOf(t);
        return { type: "read", title: t.title, extra: pct != null ? `${pct}% ${understood()}` : "", when: updated };
    });
    return { count: texts.length, chars, recent };
}

export async function minedStats() {
    const mined = (await idbAll("mined").catch(() => [])).filter(ofTarget);
    const anki = mined.filter((m) => m.ankiNoteId).length;
    return { count: mined.length, anki, items: mined };
}

export function grammarStats() {
    const all = store.get(GRAMMAR_KEY, {});
    const list = Object.values(all);
    return { learned: list.filter((g) => g.learned).length, passed: list.filter((g) => g.passed).length, byId: all };
}
