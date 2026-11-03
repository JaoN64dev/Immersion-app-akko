// The coverage engine (scripts/core/coverage.js): the one number behind every "how much of this do
// I know", plus the words worth learning first. Stubs for storage, as the pages run in a browser.
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

const { coverage, comprehension, prime, coverageIfKnown, unknownIn } = await import("../scripts/core/coverage.js");
const { setWordStatus, applyRemote } = await import("../scripts/words/status.js");

// a token the way /api/tokenize gives them
const w = (b, s = b) => ({ s, b, c: 1 });

beforeEach(() => {
    // the statuses live in memory too, so each test starts from nothing known (clear the waiting
    // queue first: applyRemote never drops a word that is still unsent)
    data.clear();
    applyRemote({}, { full: true });
});

test("coverage counts every word, repeats included, and knows how many you know", () => {
    // 犬 が 好き 犬 が 好き: 6 words, が twice
    const lines = [[w("犬"), w("が"), w("好き"), w("犬"), w("が"), w("好き")]];
    setWordStatus("犬", "known");
    setWordStatus("が", "known");
    const c = coverage(lines);
    assert.equal(c.total, 6);
    assert.equal(c.known, 4);
    assert.equal(c.pct, 67);
    assert.equal(c.unknown.get("好き"), 2, "the unknown word keeps its count");
    assert.equal(c.lines, 1);
});

test("a word marked ignored is not counted at all, and neither is punctuation or a number", () => {
    const lines = [[w("犬"), w("が"), w("走る"), { s: "。" }, { s: "2024", b: "2024" }]];
    setWordStatus("走る", "ignored");
    setWordStatus("犬", "known");
    const c = coverage(lines);
    assert.equal(c.total, 2, "the ignored word, the full stop and the number are out");
    assert.equal(c.known, 1);
    assert.equal(c.unknown.size, 1);
    assert.equal(c.unknown.get("が"), 1);
});

test("a word you are still learning is unknown: the number never flatters you", () => {
    const lines = [[w("犬"), w("走る")]];
    setWordStatus("犬", "known");
    setWordStatus("走る", "learning");
    assert.equal(coverage(lines).known, 1);
    assert.equal(coverage(lines).pct, 50);
    assert.deepEqual([...unknownIn(lines[0])], ["走る"]);
});

test("i+1: the lines with exactly one unknown word left", () => {
    const lines = [
        [w("犬"), w("走る")],            // 犬 known, 走る unknown: i+1
        [w("犬"), w("走る"), w("速い")],  // two unknown: no
        [w("犬")],                       // all known: no
        [w("走る"), w("走る")],           // one unknown word, twice: i+1
    ];
    setWordStatus("犬", "known");
    const c = coverage(lines);
    assert.equal(c.iPlus1, 2);
});

test("an empty text is 0%, not NaN", () => {
    const c = coverage([]);
    assert.deepEqual([c.pct, c.total, c.known, c.iPlus1], [0, 0, 0, 0]);
    assert.equal(comprehension([]).pct, 0);
});

test("the badge's shape is the one the pages have always used", () => {
    const lines = [[w("犬"), w("走る")]];
    setWordStatus("犬", "known");
    const c = comprehension(lines);
    assert.deepEqual(c, { pct: 50, total: 2, known: 1, unknown: 1, iPlus1: 1 });
    assert.equal(typeof c.unknown, "number");
});

test("priming: the word that finishes a line comes before the word that merely appears often", () => {
    const lines = [
        [w("犬"), w("走る")],                        // one unknown: 走る unlocks it
        [w("犬"), w("走る")],
        [w("犬"), w("猫"), w("鳥"), w("魚"), w("犬")],
    ];
    setWordStatus("犬", "known");
    const list = prime(lines, { limit: 4 });
    assert.equal(list[0].word, "走る", "2 lines unlocked, 2 appearances");
    assert.equal(list[0].unlocks, 2);
    const words = list.map((p) => p.word);
    for (const seen of ["猫", "鳥", "魚"]) assert.ok(words.includes(seen), seen);
    assert.ok(!words.includes("犬"), "a known word is never suggested");
});

test("priming skips ignored words and says how much learning them would buy", () => {
    const lines = [[w("犬"), w("走る"), w("速い")], [w("犬"), w("速い")]];
    setWordStatus("犬", "known");
    setWordStatus("走る", "ignored");
    const list = prime(lines);
    assert.deepEqual(list.map((p) => p.word), ["速い"], "the ignored one is not a word to learn");
    assert.equal(list[0].sample, "速い");
    // 犬 twice and 速い twice count (the ignored 走る doesn't): 2 of 4 known
    const before = comprehension(lines);
    assert.equal(before.pct, 50);
    const after = coverageIfKnown(lines, ["速い"]);
    assert.equal(after.pct, 100, "learning the one word leaves nothing unknown");
    assert.equal(after.iPlus1, 0, "no line has one unknown word left: they have none");
});

test("coverageIfKnown takes a Set too, and leaves everything else alone", () => {
    const lines = [[w("犬"), w("猫"), w("鳥")]];
    setWordStatus("犬", "known");
    setWordStatus("猫", "ignored");
    assert.equal(coverage(lines).pct, 50);
    assert.equal(coverageIfKnown(lines, new Set(["鳥"])).pct, 100);
});
