// The Anki deck export (scripts/anki/apkg.js): how a 復習 card's schedule becomes an Anki review
// card, and the frequency rank Lapis-style FreqSort fields get. The whole file was checked against
// Anki's own importer (the `anki` Python package): notes, media, schedule, and no duplicates on a
// second import — that needs a browser for sql.js, so it isn't repeated here.
import { test } from 'node:test';
import assert from 'node:assert/strict';


const { scheduleOf, freqRank } = await import('../scripts/anki/schedule.js');
const DAY = 864e5;

test('a reviewed 復習 card becomes an Anki review card with its interval and due day', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    const crt = Math.floor(Date.parse('2025-11-24T00:00:00Z') / 1000);
    const s = scheduleOf({ s: 12, reps: 3, lapses: 1, last: now - 2 * DAY, due: now + 10 * DAY }, crt);
    assert.equal(s.type, 2);
    assert.equal(s.queue, 2);
    assert.equal(s.ivl, 12, 'the days between the last review and the next one');
    assert.equal(s.due, Math.floor(((now + 10 * DAY) / 1000 - crt) / 86400), 'counted in days from the collection start');
    assert.equal(s.reps, 3);
    assert.equal(s.lapses, 1);
});

test('a word never reviewed stays a new card', () => {
    assert.equal(scheduleOf(undefined, 0), null);
    assert.equal(scheduleOf({ s: 0, reps: 0 }, 0), null);
    assert.equal(scheduleOf({ s: 3, reps: 0, due: Date.now() }, 0), null);
});

test('FreqSort is the most common rank as a bare number', () => {
    assert.equal(freqRank({ freq: [{ title: 'JPDB', value: '2410' }, { title: 'Novels', value: '1,203' }] }), '1203');
    assert.equal(freqRank({ freq: [{ title: 'JPDB', value: 815 }] }), '815');
    assert.equal(freqRank({ freq: [] }), '');
    assert.equal(freqRank({}), '');
});

// ---------- importing an Anki file (scripts/anki/import-apkg.js) ----------
// The whole import was checked in a browser against files made by Anki's own exporter, in both
// layouts (collection.anki21 and the zstd collection.anki21b).
const { wordFieldIndex, statusOf, cleanWord } = await import('../scripts/anki/schedule.js');

test('the word field: named like one, else the first; never the sentence or the reading', () => {
    assert.equal(wordFieldIndex(['Sentence', 'Word', 'Reading', 'Meaning']), 1);
    assert.equal(wordFieldIndex(['Expression', 'Reading', 'Meaning']), 0);
    assert.equal(wordFieldIndex(['SentenceWord', 'Vocab', 'VocabAudio']), 1, 'not a sentence field that says word, not the audio');
    assert.equal(wordFieldIndex(['Front', 'Back']), 0);
    assert.equal(wordFieldIndex(['Text', 'Extra']), 0, 'nothing says word: the first field');
});

test('a mature card (21 days or more) makes the word known; anything else learning', () => {
    assert.equal(statusOf([40]), 'known');
    assert.equal(statusOf([21]), 'known');
    assert.equal(statusOf([5, 0]), 'learning');
    assert.equal(statusOf([5, 30]), 'known', 'one mature card is enough');
    assert.equal(statusOf([]), 'learning');
});

test('a field becomes the word: markup, furigana and alternatives dropped', () => {
    assert.equal(cleanWord('<b>犬</b>[いぬ]'), '犬');
    assert.equal(cleanWord('食べる, 喰べる'), '食べる');
    assert.equal(cleanWord('&nbsp;猫&nbsp;'), '猫');
    assert.equal(cleanWord(''), '');
});
