// Known / learning / new / ignored words.
// Keyed by dictionary form (食べる), so every conjugation shares one status.
// Any change fires "akko-words-changed" on window, so every page can re-colour itself.
// The list is shared with akko's other windows, phones and the extension through the server
// (scripts/core/words-sync.js): changes made here wait in "akko-words-pending" until it has them.

import { store } from "../core/utils.js";
import { keyFor } from "../core/target.js";

const KEY = keyFor("akko-words");     // each language you learn has its own
const PENDING = keyFor("akko-words-pending");
const words = store.get(KEY, {});
const pending = {};                   // changed here, not yet sent (saved with the list)

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
    if (didChange) pending[lemma] = status;
    if (save && didChange) saveWords();
    return didChange;
}

export function saveWords() {
    if (Object.keys(pending).length) {
        store.set(PENDING, { ...store.get(PENDING, {}), ...pending });
        for (const k of Object.keys(pending)) delete pending[k];
    }
    store.set(KEY, words);
    changed();
}

// What the server says changed elsewhere (or the whole list): words still waiting to be sent
// keep their status from here. Used by scripts/core/words-sync.js for the language being learnt.
export function applyRemote(changes, { full = false } = {}) {
    const waiting = store.get(PENDING, {});
    if (full) for (const k of Object.keys(words)) if (!(k in changes) && !(k in waiting)) delete words[k];
    let n = 0;
    for (const [w, s] of Object.entries(changes)) {
        if (w in waiting || (words[w] || "new") === s) continue;
        if (s === "new") delete words[w]; else words[w] = s;
        n++;
    }
    if (n || full) { store.set(KEY, words); changed(); }
    return n;
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
