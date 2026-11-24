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
