// The pure half of the Anki side: no page, no storage (tests/apkg.test.mjs).

const DAY = 864e5;

// "<b>食べる</b>[たべる]" / "食べる, 喰べる" -> "食べる"
export const cleanWord = (html) => String(html || "")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\[[^\]]*\]/g, "")
    .trim().split(/[\s,、・;/]+/)[0];

// Which field of a note type holds the word: the first whose name says so (Word, Expression,
// Vocab, Kanji, Front, Key…; never a sentence, reading or audio field), else the first field
export function wordFieldIndex(names) {
    const bad = /sentence|reading|kana|furigana|audio|sound|meaning|definition|english|picture|image|back/i;
    const good = /^(word|expression|vocab(ulary)?|vocab.?kanji|kanji|term|front|key|target.?word|単語|語彙)$|word|expression|vocab/i;
    const i = names.findIndex((n) => good.test(n) && !bad.test(n));
    return i >= 0 ? i : 0;
}

// A note's cards -> the word's status: any card with an interval of 21 days or more (Anki's
// "mature") makes it known, anything else learning. The same rule as the AnkiConnect import.
export const statusOf = (intervals) => (intervals.some((ivl) => ivl >= 21) ? "known" : "learning");

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
