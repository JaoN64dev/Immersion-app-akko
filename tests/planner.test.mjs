// The planner (scripts/core/planner.js): a week of reading from what you already have, in the order
// a learner gets the most out of — the same storage stubs as the coverage tests.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const data = new Map();
globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
};
globalThis.window = { dispatchEvent() {}, addEventListener() {} };
globalThis.Event = class { constructor(type) { this.type = type; } };

const { assess, planWeek, planPriming, bandOf, minutesFor } = await import("../scripts/core/planner.js");
const { setWordStatus, applyRemote } = await import("../scripts/words/status.js");

const w = (b) => ({ s: b, b, c: 1 });

// a text where `known` of `total` words you know: the rest are numbered unknowns
function text(known, total) {
    const lines = [];
    for (let i = 0; i < total; i++) lines.push([w(i < known ? `知${i}` : `未${i}`)]);
    for (let i = 0; i < known; i++) setWordStatus(`知${i}`, "known");
    return lines;
}

beforeEach(() => {
    data.clear();
    applyRemote({}, { full: true });
});

test("the bands say what to do, and 100% is comfortable", () => {
    assert.equal(bandOf(100).key, "comfortable");
    assert.equal(bandOf(95).key, "comfortable");
    assert.equal(bandOf(94).key, "stretch");
    assert.equal(bandOf(85).key, "stretch");
    assert.equal(bandOf(84).key, "hard");
    assert.equal(bandOf(0).key, "hard");
    assert.equal(minutesFor(1000), 10);
    assert.equal(minutesFor(0), 5);
});

test("a text is assessed by what you know, and its length becomes minutes", () => {
    const [item] = assess([{ id: "a", title: "A", lines: text(20, 25) }]);
    assert.equal(item.pct, 80);
    assert.equal(item.band, "hard");
    assert.equal(item.unknown, 5);
    assert.equal(item.minutes, 5, "25 words is still the 5 minute floor");
});

test("the stretch comes first, then finishing what you started", () => {
    const items = [
        { id: "easy", title: "Easy", lines: text(30, 30) },
        { id: "hard", title: "Hard", lines: text(10, 30) },
        { id: "stretch-new", title: "Stretch", lines: text(27, 30) },
        { id: "stretch-started", title: "Stretch, started", lines: text(27, 30), position: 4 },
    ];
    const { days } = planWeek(items, { days: 7, minutes: 60 });
    const order = days.flatMap((d) => d.items).map((i) => i.id);
    assert.deepEqual(order, ["stretch-started", "stretch-new", "easy", "hard"]);
});

test("a week never plans a text twice, and the leftovers are kept", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, lines: text(28, 30) }));
    const { days, left } = planWeek(items, { days: 3, minutes: 5 });
    const planned = days.flatMap((d) => d.items).map((i) => i.id);
    assert.equal(planned.length, 3, "one 5 minute text each day");
    assert.equal(new Set(planned).size, 3, "no text twice");
    assert.equal(left.length, 7, "the rest waits for next week");
});

test("a day takes more than one text when there is room, and never goes over", () => {
    const items = [
        { id: "a", title: "A", lines: text(28, 30), minutes: 10 },
        { id: "b", title: "B", lines: text(28, 30), minutes: 10 },
        { id: "c", title: "C", lines: text(28, 30), minutes: 30 },
    ];
    const { days } = planWeek(items, { days: 7, minutes: 25 });
    assert.deepEqual(days[0].items.map((i) => i.id), ["a", "b"]);
    assert.equal(days[0].minutes, 20);
    assert.deepEqual(days[1].items.map((i) => i.id), ["c"], "a text longer than a day still gets one");
});

test("nothing to read is an empty plan, not a crash", () => {
    const plan = planWeek([], { days: 7 });
    assert.deepEqual(plan.days, []);
    assert.deepEqual(plan.left, []);
    assert.deepEqual(planPriming(plan), []);
});

test("priming across the plan: the words the whole week keeps meeting", () => {
    const shared = [w("共通"), w("語")]
    const a = [[...shared, w("犬")]];
    const b = [[...shared, w("猫")]];
    const items = [
        { id: "a", title: "A", lines: a },
        { id: "b", title: "B", lines: b },
    ];
    const plan = planWeek(items, { days: 7, minutes: 60 });
    const words = planPriming(plan, { limit: 5 }).map((p) => p.word);
    assert.equal(words[0], "共通", "in both texts, twice");
    assert.ok(words.includes("犬") && words.includes("猫"), "and the ones in one text");
    assert.equal(words.length, 4, 'every word in the plan, none repeated');
});

test("a word you already know is never in the plan's priming, and ignored words stay out", () => {
    const items = [{ id: "a", title: "A", lines: [[w("犬"), w("猫"), w("鳥")]] }];
    setWordStatus("犬", "known");
    setWordStatus("猫", "ignored");
    const words = planPriming(planWeek(items, { days: 7 })).map((p) => p.word);
    assert.deepEqual(words, ["鳥"]);
});
