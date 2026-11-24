// 読む → a PDF: pdf.js gives the text a line at a time, broken wherever the page edge was. These
// are the rules that glue a book's sentences back together (scripts/reader/import.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || { addEventListener() {}, dispatchEvent() {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const { pdfLinesToParagraphs } = await import('../scripts/reader/import.js');

test('Japanese lines broken mid-sentence are glued back with no space', () => {
    assert.deepEqual(pdfLinesToParagraphs(['吾輩は猫である。名前はまだ無', 'い。どこで生れたかとんと見当がつか', 'ぬ。']),
        ['吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。']);
});

test('a line ending a sentence, or a blank line, ends the paragraph', () => {
    assert.deepEqual(pdfLinesToParagraphs(['一つ目の文。', '二つ目の', '文', '', '第二章']),
        ['一つ目の文。', '二つ目の文', '第二章']);
});

test('English is glued with a space, and a hyphenated break is mended', () => {
    assert.deepEqual(pdfLinesToParagraphs(['This is an Eng-', 'lish line that wraps', 'across lines.']),
        ['This is an English line that wraps across lines.']);
});

test("a font's radical look-alikes become the kanji they stand for (⽣ → 生), nothing else is touched", () => {
    assert.deepEqual(pdfLinesToParagraphs(['どこで⽣れたかとんと⾒', '当がつかぬ。']), ['どこで生れたかとんと見当がつかぬ。']);
    assert.deepEqual(pdfLinesToParagraphs(['①ＡＢ']), ['①ＡＢ']);
});
