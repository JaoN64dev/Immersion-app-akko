// Grammar lessons (grammar/*.md, served by /api/grammar) and what you've done with them.
// Progress is saved in "akko-grammar" ("akko-grammar-en" for English):
// { id: {learned, quizBest, quizTotal, passed, updated} }

import { store, getJson } from "../core/utils.js";
import { keyFor, target, nativeLang } from "../core/target.js";

export const PROGRESS_KEY = keyFor("akko-grammar");

let loading = null;

// {lessons: [{id, title, meaning, level, order, see}], problems}, fetched once per page
export function loadLessons() {
    if (!loading) loading = getJson("/api/grammar?" + query()).catch((err) => { loading = null; throw err; });
    return loading;
}

// one whole lesson (explanation, examples, quiz, rules), fetched when it's opened
export const loadLesson = (id) => getJson(`/api/grammar/${encodeURIComponent(id)}?` + query());

// English lessons come in your language when there's a translation (grammar-en/<code>/)
const query = () => new URLSearchParams({ lang: target(), native: nativeLang() });

// id -> lesson (title, meaning, level…); empty if the server can't be reached
export async function lessonMap() {
    try {
        const { lessons } = await loadLessons();
        return new Map(lessons.map((l) => [l.id, l]));
    } catch {
        return new Map();
    }
}

export const allProgress = () => store.get(PROGRESS_KEY, {});
export const lessonProgress = (id) => allProgress()[id] || {};

export function saveProgress(id, changes) {
    const all = allProgress();
    all[id] = { ...all[id], ...changes, updated: Date.now() };
    store.set(PROGRESS_KEY, all);
}
