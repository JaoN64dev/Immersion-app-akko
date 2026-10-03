// Known / learning / new / ignored words.
// Keyed by dictionary form (食べる), so every conjugation shares one status.
// Any change fires "akko-words-changed" on window, so every page can re-colour itself.

import { store } from "../core/utils.js";
import { keyFor } from "../core/target.js";

const KEY = keyFor("akko-words");     // each language you learn has its own
const words = store.get(KEY, {});

// [status, button label]; the order is also the 1-4 keyboard shortcut
export const STATUSES = [["new", "new"], ["learning", "learning"], ["known", "known ✓"], ["ignored", "ignore"]];

export const wordStatus = (lemma) => words[lemma] || "new";

// "ignored" words (sound effects, names, junk) never count as unknown and aren't coloured
export const counts = (lemma) => wordStatus(lemma) !== "ignored";
export const isUnknown = (lemma) => { const s = wordStatus(lemma); return s === "new" || s === "learning"; };

const changed = () => window.dispatchEvent(new Event("akko-words-changed"));

// Returns whether anything changed. downgrade:false never touches known/ignored words (Anki import).
// save:false is for bulk updates: call saveWords() once at the end.
export function setWordStatus(lemma, status, { save = true, downgrade = true } = {}) {
    if (!lemma) return false;
    const before = wordStatus(lemma);
    if (!downgrade && (before === "known" || before === "ignored")) return false;
    if (status === "new") delete words[lemma]; else words[lemma] = status;
    const didChange = before !== status;
    if (save && didChange) saveWords();
    return didChange;
}

export function saveWords() {
    store.set(KEY, words);
    changed();
}

// {known: n, learning: n, ignored: n}
export function wordCounts(map = words) {
    const c = { known: 0, learning: 0, ignored: 0 };
    Object.values(map).forEach((s) => { c[s] = (c[s] || 0) + 1; });
    return c;
}

// colour class for a comprehension %
export const pctLevel = (pct) => (pct >= 90 ? "high" : pct >= 70 ? "mid" : "low");

// another tab (e.g. the reader) changed a word: pick it up here too
window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    for (const k of Object.keys(words)) delete words[k];
    Object.assign(words, store.get(KEY, {}));
    changed();
});
