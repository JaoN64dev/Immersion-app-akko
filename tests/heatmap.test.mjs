// The year heatmap (scripts/core/heatmap.js): which square each day is, how dark, and the totals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearGrid, levelOf, ACTIVE_SECONDS } from '../scripts/core/heatmap.js';

test('levels: nothing, then under 15 min, 30 min, an hour, and an hour or more', () => {
    assert.equal(levelOf(0), 0);
    assert.equal(levelOf(ACTIVE_SECONDS - 1), 0, 'under a minute is not a day yet (same as the streak)');
    assert.equal(levelOf(5 * 60), 1);
    assert.equal(levelOf(20 * 60), 2);
    assert.equal(levelOf(45 * 60), 3);
    assert.equal(levelOf(3 * 3600), 4);
    assert.equal(levelOf(undefined), 0);
});

test('53 columns of 7, Monday on top, today the last filled square', () => {
    const g = yearGrid({}, '2026-11-24');                 // a Tuesday
    assert.equal(g.weeks.length, 53);
    assert.ok(g.weeks.every((w) => w.length === 7));
    const last = g.weeks[52];
    assert.equal(last[0].day, '2026-11-23', 'the last column starts on Monday');
    assert.equal(last[1].day, '2026-11-24');
    assert.deepEqual(last.slice(2), [null, null, null, null, null], 'no squares after today');
    assert.equal(g.weeks[0][0].day, '2025-11-24', '52 weeks before that Monday');
});

test('totals: active days, the longest run, and hours', () => {
    const days = {
        '2026-11-20': 1800, '2026-11-21': 600, '2026-11-22': 3600,   // three days in a row
        '2026-11-24': 30,                                            // under a minute: not active
        '2026-10-01': 7200,
        '2024-01-01': 99999,                                         // outside the year: ignored
    };
    const g = yearGrid(days, '2026-11-24');
    assert.equal(g.active, 4);
    assert.equal(g.longest, 3);
    assert.equal(g.hours, Math.round((1800 + 600 + 3600 + 30 + 7200) / 360) / 10);
    const cell = g.weeks.flat().find((c) => c && c.day === '2026-11-22');
    assert.equal(cell.level, 4);
});

test('month labels sit on the column where the month begins, never two side by side', () => {
    const g = yearGrid({}, '2026-11-24');
    const nov = g.months.find((m) => m.month === 10 && m.year === 2026);
    assert.ok(nov, 'November 2026 is labelled');
    const col = g.weeks[nov.week].map((c) => c && c.day);
    assert.ok(col.includes('2026-11-01'), 'on the column holding the 1st');
    for (let i = 1; i < g.months.length; i++) assert.ok(g.months[i].week - g.months[i - 1].week >= 2);
});

test('bad data counts as nothing', () => {
    const g = yearGrid({ '2026-11-24': 'lots', '2026-11-23': -50 }, '2026-11-24');
    assert.equal(g.active, 0);
    assert.equal(g.hours, 0);
    assert.doesNotThrow(() => yearGrid(null, '2026-11-24'));
});
