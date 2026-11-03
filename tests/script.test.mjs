// Which language a text is written in (scripts/core/script.js). This is the fix for a Japanese book
// imported during a German session: filed as German, "tokenized" by the space splitter, every line
// came back as one word — and the planner offered whole sentences as words to learn.
import { test } from "node:test";
import assert from "node:assert/strict";

const { scriptOf, langOf, belongsTo } = await import("../scripts/core/script.js");

test("the writing system is read from the text", () => {
    assert.equal(scriptOf("吾輩は猫である。名前はまだ無い。"), "japanese", "kana in it: Japanese");
    assert.equal(scriptOf("我愛中文"), "han", "Han only: could be Chinese");
    assert.equal(scriptOf("한국어를 공부해요"), "hangul");
    assert.equal(scriptOf("Привет, мир"), "cyrillic");
    assert.equal(scriptOf("Καλημέρα"), "greek");
    assert.equal(scriptOf("مرحبا"), "arabic");
    assert.equal(scriptOf("שלום"), "hebrew");
    assert.equal(scriptOf("नमस्ते"), "devanagari");
    assert.equal(scriptOf("สวัสดี"), "thai");
    assert.equal(scriptOf("Ich lerne Deutsch."), "latin");
    assert.equal(scriptOf(""), "latin");
});

test("a text is read in its own language, not the one being learnt", () => {
    assert.equal(langOf("吾輩は猫である。", "de"), "ja", "Japanese while learning German is Japanese");
    assert.equal(langOf("한국어를 공부해요", "ja"), "ko");
    assert.equal(langOf("吾輩は猫である。", "ja"), "ja");
    assert.equal(langOf("我愛中文", "ja"), "ja", "Han only, learning Japanese: Japanese has kanji too");
    assert.equal(langOf("我愛中文", "cmn"), "cmn");
    assert.equal(langOf("Ich lerne Deutsch.", "de"), "de", "a Latin text stays with the language being learnt");
    assert.equal(langOf("Привет", "ru"), "ru");
    assert.equal(langOf("Привет", "de"), "ru", "Cyrillic is not German's");
});

test("the library only shows what is written in the language being learnt", () => {
    assert.equal(belongsTo("吾輩は猫である。", "ja"), true);
    assert.equal(belongsTo("吾輩は猫である。", "de"), false);
    assert.equal(belongsTo("Ich lerne Deutsch.", "de"), true);
});
