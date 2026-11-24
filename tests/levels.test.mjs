// Stats 2.0 (scripts/core/levels.js): retention by where a word was mined, and the time to the next
// milestone of known words at the pace of the last 30 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const saved = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (saved.has(k) ? saved.get(k) : null),
    setItem: (k, v) => saved.set(k, String(v)),
    removeItem: (k) => saved.delete(k),
    key: (i) => [...saved.keys()][i] ?? null,
    get length() { return saved.size; },
};
globalThis.window = globalThis.window || { addEventListener() {}, dispatchEvent() {} };
globalThis.Event = globalThis.Event || class { constructor(type) { this.type = type; } };

const levels = await import('../scripts/core/levels.js');
const DAY = 864e5;

test('the source of a mined word: said by new ones, recognised in old ones', () => {
    assert.equal(levels.sourceKind({ kind: 'manga', source: 'x' }), 'manga');
    assert.equal(levels.sourceKind({ videoName: 'ep1.mkv', source: 'Show — ep1.mkv', time: '03:12' }), 'watch');
    assert.equal(levels.sourceKind({ url: 'https://example.com', source: 'Example' }), 'web');
    assert.equal(levels.sourceKind({ source: '文法 て形' }), 'grammar');
    assert.equal(levels.sourceKind({ source: '聴解 N3 会話' }), 'listening');
    assert.equal(levels.sourceKind({ source: 'よつばと！ 1 p.12' }), 'manga');
    assert.equal(levels.sourceKind({ source: 'Podcast — ep', time: '12:00' }), 'listen');
    assert.equal(levels.sourceKind({ source: '吾輩は猫である' }), 'read');
    assert.equal(levels.sourceKind({}), 'other');
    assert.equal(levels.sourceKind({ kind: 'nonsense', source: 'book' }), 'read', 'an unknown kind falls back to the guess');
});

test('retention by source: reviews passed and today\'s recall, per kind, reviewed words only', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    const mined = [
        { word: '猫', kind: 'watch' },
        { word: '犬', kind: 'watch' },
        { word: '猫', kind: 'read' },            // mined again elsewhere: counts once, for where it came first
        { word: '鳥', kind: 'read' },
        { word: '魚', kind: 'manga' },           // never reviewed: no manga row
    ];
    const cards = {
        猫: { s: 10, reps: 4, lapses: 1, last: now },         // remembered for sure right after a review
        犬: { s: 10, reps: 2, lapses: 0, last: now - 10 * DAY },
        鳥: { s: 5, reps: 5, lapses: 0, last: now },
    };
    const rows = levels.retentionBySource(mined, cards, now);
    assert.deepEqual(rows.map((r) => r.kind), ['watch', 'read']);
    const watch = rows[0];
    assert.equal(watch.words, 2);
    assert.equal(watch.reviewed, 2);
    assert.equal(watch.reps, 6);
    assert.equal(watch.passed, 5 / 6);
    // 猫 at 100%, 犬 at 90% (FSRS: S days after the last review is 90%)
    assert.ok(Math.abs(watch.recall - 0.95) < 1e-9, `recall ${watch.recall}`);
    assert.equal(rows[1].words, 1, '猫 is not counted again for texts');
});

test('next level: the milestone, and no pace until there is a week of history', () => {
    const l = levels.nextLevel({ '2026-11-22': 900, '2026-11-24': 950 }, 950, '2026-11-24');
    assert.equal(l.next, 1000);
    assert.equal(l.left, 50);
    assert.equal(l.perDay, null);
    assert.equal(l.days, null);
});

test('next level: the pace of the last 30 days says when', () => {
    const history = { '2026-09-01': 0, '2026-10-25': 700, '2026-11-14': 850, '2026-11-24': 1000 };
    const l = levels.nextLevel(history, 1000, '2026-11-24');
    assert.equal(l.next, 2000);
    assert.equal(l.since, '2026-10-25', 'older days are outside the window');
    assert.equal(l.perDay, 10);
    assert.equal(l.days, 100);
});

test('next level: no progress means no date, and past the last milestone there is no next', () => {
    const flat = levels.nextLevel({ '2026-11-01': 500, '2026-11-24': 500 }, 500, '2026-11-24');
    assert.equal(flat.perDay, 0);
    assert.equal(flat.days, null);
    assert.equal(levels.nextLevel({}, 50000, '2026-11-24').next, null);
});

test('snapshot writes today\'s count once and keeps it per language', () => {
    localStorage.setItem('akko-words', JSON.stringify({ 猫: 'known', 犬: 'known', 鳥: 'learning', 魚: 'ignored' }));
    const days = levels.snapshot(new Date('2026-11-24T12:00:00'));
    assert.equal(days['2026-11-24'], 2);
    assert.equal(JSON.parse(localStorage.getItem('akko-known-days'))['2026-11-24'], 2);
});
