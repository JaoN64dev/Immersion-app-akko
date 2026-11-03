// The language table (scripts/core/target.js): ja and en behave exactly as they did, other
// languages are accepted with their own storage, and a tag nobody has looked at still works.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = new Map();
globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
};
globalThis.window = { dispatchEvent() {} };
globalThis.Event = class { constructor(type) { this.type = type; } };

const {
    LANGUAGES, LANGUAGE_CHOICES, LEARNABLE, isKnown, profile, has,
    chosen, target, learningEnglish, understood, keyFor, ofTarget, setTarget, usesFullStop, pagesFor,
} = await import("../scripts/core/target.js");

const reset = () => data.clear();

test("nothing saved yet: Japanese, and it isn't a choice made", () => {
    reset();
    assert.equal(chosen(), false);
    assert.equal(target(), "ja");
    assert.equal(learningEnglish(), false);
    assert.equal(understood(), "理解");
    // Japanese keeps the storage names it always had, so nothing saved before this changes
    assert.equal(keyFor("akko-words"), "akko-words");
    assert.equal(profile().english, "Japanese");
    assert.equal(has("lessons"), true);
    assert.equal(has("handwriting"), true);
});

test("English is where it was: its own keys, its own dictionary, no lessons", () => {
    reset();
    assert.equal(setTarget("en"), true);
    assert.equal(chosen(), true);
    assert.equal(target(), "en");
    assert.equal(learningEnglish(), true);
    assert.equal(understood(), "understood");
    assert.equal(keyFor("akko-words"), "akko-words-en");
    assert.equal(profile().dictionary, "wordnet");
    assert.equal(profile().readings, "ipa");
    assert.equal(has("lessons"), false);
    assert.equal(ofTarget({ lang: "en" }), true);
    assert.equal(ofTarget({}), false, "records without a lang are Japanese");
});

test("one of the new languages: its own storage and its own capabilities", () => {
    reset();
    setTarget("de");
    assert.equal(target(), "de");
    assert.equal(keyFor("akko-cards"), "akko-cards-de");
    assert.equal(profile().name, "Deutsch");
    assert.equal(profile().dictionary, "yomitan", "a dictionary you install");
    assert.equal(has("lessons"), false);
    assert.equal(has("handwriting"), false);
    assert.equal(has("rtl"), false);
    assert.equal(ofTarget({ lang: "de" }), true);
    assert.equal(ofTarget({ lang: "ja" }), false);
});

test("the languages that shape how text is read", () => {
    assert.equal(profile("ko").tokenizer, "ko");
    assert.equal(profile("ko").readings, "romaja");
    assert.equal(profile("cmn").tokenizer, "cjk");
    assert.equal(profile("cmn").readings, "pinyin");
    assert.equal(profile("cmn").handwriting, true, "hanzi are written like kanji");
    assert.equal(profile("ru").script, "cyrillic");
    assert.equal(profile("ar").rtl, true);
    assert.equal(profile("fa").rtl, true);
    assert.equal(profile("th").tokenizer, "segment", "no spaces to split on");
    assert.equal(profile("ja").rtl, false);
});

test("a language nobody listed still works, with a generic profile", () => {
    reset();
    assert.equal(isKnown("sw"), true, "a two-letter tag is a language");
    assert.equal(isKnown("pt-BR"), true);
    setTarget("sw");
    assert.equal(target(), "sw");
    assert.equal(keyFor("akko-words"), "akko-words-sw");
    const p = profile();
    assert.equal(p.generic, true);
    assert.equal(p.dictionary, "yomitan");
    assert.equal(p.tokenizer, "space");
    assert.equal(p.readings, "none");
    assert.equal(p.lessons, false);
});

test("a broken saved value falls back to Japanese, and a bad setTarget changes nothing", () => {
    reset();
    data.set("akko-settings", JSON.stringify({ target: "not a language" }));
    assert.equal(chosen(), false, "so the welcome screen asks again");
    assert.equal(target(), "ja");
    setTarget("ja");
    assert.equal(setTarget("!!"), false);
    assert.equal(target(), "ja");
});

test("every language in the table is complete, and the picker has them all", () => {
    const fields = ["name", "english", "tokenizer", "readings", "dictionary", "lessons", "voices", "handwriting", "script", "rtl"];
    for (const [tag, p] of Object.entries(LANGUAGES)) {
        for (const f of fields) assert.ok(p[f] !== undefined, `${tag} is missing ${f}`);
        assert.equal(isKnown(tag), true, tag);
    }
    assert.deepEqual(LANGUAGE_CHOICES.slice(0, 2), ["ja", "en"]);
    assert.equal(LANGUAGE_CHOICES.length, Object.keys(LANGUAGES).length);
    assert.equal(new Set(LANGUAGE_CHOICES).size, LANGUAGE_CHOICES.length, "no repeats");
    assert.equal(LEARNABLE.de, "German");
    // the seven the picker was asked for are in it
    for (const tag of ["de", "pl", "ru", "cmn", "ko", "es", "it"]) assert.ok(LANGUAGES[tag], tag);
});

test("sentences end with 。 in Japanese and Chinese, with a full stop everywhere else", async () => {
    assert.equal(usesFullStop("ja"), false);
    assert.equal(usesFullStop("cmn"), false);
    for (const tag of ["ko", "de", "ru", "ar"]) assert.equal(usesFullStop(tag), true, tag);
});

test("the pages a language has: Japanese lessons for Japanese, the English ones for English", () => {
    const ja = pagesFor("ja");
    assert.equal(ja.course && ja.grammar && ja.drills && ja.expressions, true);

    // English has its own course and grammar (course-en/, grammar-en/), and nothing else: 聴解 is a
    // JLPT exam and 表現 is Japanese idioms
    const en = pagesFor("en");
    assert.equal(en.course && en.grammar, true, "the English course is a course");
    assert.equal(en.drills || en.expressions, false, "no JLPT drills, no Japanese idioms");
    assert.equal(en.watch && en.read && en.review && en.listen, true);

    // a third language has the four pages taken away, as before
    for (const tag of ["ko", "cmn", "de", "sw"]) {
        const pages = pagesFor(tag);
        assert.equal(pages.course || pages.grammar || pages.drills || pages.expressions, false, tag);
        assert.equal(pages.watch && pages.read && pages.review, true, `${tag} can read and review`);
    }
});

test("a page a language has really has files behind it", () => {
    // the flag and the folder must agree, or the tab opens onto an empty page
    for (const [tag, dirs] of [["ja", ["course", "grammar"]], ["en", ["course-en", "grammar-en"]]]) {
        const pages = pagesFor(tag);
        assert.equal(pages.course && pages.grammar, true, tag);
        for (const dir of dirs) assert.ok(existsSync(path.join(root, dir)), `${dir} exists`);
    }
});
