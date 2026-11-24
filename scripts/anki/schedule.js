// The pure half of the Anki side: no page, no storage (tests/apkg.test.mjs).

const DAY = 864e5;

// The most common rank among the word's frequency lists, as a bare number (empty when it has none):
// what Lapis-style FreqSort fields sort by
export function freqRank(item) {
    const ranks = (item.freq || []).map((f) => parseInt(String(f.value).replace(/[^\d]/g, ""), 10)).filter((n) => n > 0);
    return ranks.length ? String(Math.min(...ranks)) : "";
}

// The schedule of a 復習 card ({s, due, last, reps, lapses}) as an Anki review card, with `crt` the
// collection's first day (seconds). null: leave it new.
export function scheduleOf(card, crt) {
    if (!card || !card.s || !card.reps || !card.due) return null;
    const ivl = Math.max(1, Math.round(((card.due - (card.last || card.due)) / DAY)) || Math.round(card.s));
    return {
        type: 2, queue: 2,
        due: Math.max(0, Math.floor((card.due / 1000 - crt) / 86400)),
        ivl, factor: 2500, reps: card.reps, lapses: card.lapses || 0,
    };
}
