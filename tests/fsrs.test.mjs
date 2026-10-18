// 復習's spaced repetition (scripts/words/fsrs.js): FSRS-4.5 with its default weights.
import { test } from "node:test";
import assert from "node:assert/strict";
import { review, preview, isDue, intervalDays, retrievability, describe } from "../scripts/words/fsrs.js";

const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 1, 12);
const days = (card, now) => Math.round((card.due - now) / DAY);

test("a new word: again comes back in a minute; hard < good < easy", () => {
    const again = review({}, 1, T0);
    assert.equal(again.due - T0, 60e3);
    assert.equal(again.reps, 1);
    assert.equal(again.lapses, 0, "a new word you didn't know isn't a lapse");
    const [hard, good, easy] = [2, 3, 4].map((g) => review({}, g, T0));
    assert.equal(days(good, T0), 4);                  // FSRS-4.5: 3.7 days
    assert.equal(days(easy, T0), 14);
    assert.ok(days(hard, T0) <= days(good, T0) && days(good, T0) < days(easy, T0));
    for (const c of [again, hard, good, easy]) assert.ok(c.d >= 1 && c.d <= 10);
});

test("remembering it again makes the gaps grow; forgetting shrinks them", () => {
    let c = review({}, 3, T0);
    let now = c.due;
    const gaps = [];
    for (let i = 0; i < 4; i++) {
        c = review(c, 3, now);
        gaps.push(days(c, now));
        now = c.due;
    }
    for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], `gaps grow: ${gaps}`);
    const lapse = review(c, 1, now);
    assert.equal(lapse.lapses, 1);
    assert.ok(lapse.s < c.s, "forgetting lowers stability");
    assert.ok(lapse.d > c.d, "and makes the word harder");
    // relearned the same day: back after the lowered stability (FSRS doesn't start a known word over)
    const relearned = review(lapse, 3, now + 5 * 60e3);
    assert.equal(days(relearned, now), Math.round(lapse.s));
    assert.ok(days(relearned, now) < gaps[gaps.length - 1] / 10);
});

test("helpers: due, intervals at 90% retention, labels", () => {
    assert.equal(isDue(null), false);
    assert.equal(isDue({}), false, "a new card isn't 'due', it's new");
    const c = review({}, 3, T0);
    assert.equal(isDue(c, T0 + DAY), false);
    assert.equal(isDue(c, c.due), true);
    assert.equal(intervalDays(10), 10, "at 90% retention the interval equals the stability");
    assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
    assert.deepEqual(Object.keys(preview({}, T0)), ["1", "2", "3", "4"]);
    assert.equal(preview({}, T0)[1], "1 min");
    assert.equal(describe(3 * DAY), "3 d");
    assert.equal(describe(90 * DAY), "3 mo");
});
