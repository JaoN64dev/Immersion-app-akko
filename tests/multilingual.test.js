// The dictionary-first languages (server/multilingual.js): Korean and Chinese split into words,
// readings over them, and every other language through its Yomitan dictionary. The last test runs
// the real thing: a Korean dictionary uploaded with ?lang=ko, then /api/tokenize and /api/dict.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-multilingual-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AdmZip = require('adm-zip');
const multilingual = require('../server/multilingual');
const dictionary = require('../server/dictionary');

// a dictionary, as much of one as the splitter asks about
const fake = (headwords, readings = {}) => ({
    has: (q) => headwords.includes(q),
    reading: (q) => readings[q] || '',
});
// one server for the whole file: the dictionary routes and the tokenizer
const app = express();
app.use('/api/dictionaries', require('../server/dictionaries').router);
app.use('/api', dictionary.router);
let server, base;
before(async () => {
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
    server.close();
    fs.rmSync(process.env.AKKO_DATA, { recursive: true, force: true });
});
// a Yomitan dictionary for this language, the way Settings does it
const upload = async (buf, lang) => {
    const res = await fetch(`${base}/dictionary/upload?lang=${lang}`, { method: 'POST', body: buf });
    assert.equal(res.status, 200, 'the dictionary was accepted');
    return base;
};

const words = (line, lang, dict) => multilingual.tokenize(line, lang, dict).filter((t) => t.b);
const bases = (line, lang, dict) => words(line, lang, dict).map((t) => t.b);
const joined = (line, lang, dict) => multilingual.tokenize(line, lang, dict).map((t) => t.s).join('');

test("Korean is romanised the way it's said", () => {
    const say = multilingual.romanizeHangul;
    assert.equal(say('한국어'), 'hangugeo');            // 연음: the final moves to the next syllable
    assert.equal(say('안녕하세요'), 'annyeonghaseyo');
    assert.equal(say('합니다'), 'hamnida');              // 비음화
    assert.equal(say('신라'), 'silla');                  // 유음화
    assert.equal(say('강릉'), 'gangneung');
    assert.equal(say('독립'), 'dongnip');
    assert.equal(say('심리'), 'simni');
    assert.equal(say('좋아'), 'joa');
    assert.equal(say('K-pop 좋아'), 'K-pop joa', 'everything that is not Hangul is left alone');
});

test('Korean words lose their particle, so the word you save is the dictionary one', () => {
    const dict = fake(['한국어', '물', '학교', '학생']);
    const line = '한국어를 공부해요';
    const tokens = words(line, 'ko', dict);
    assert.deepEqual(tokens.map((t) => [t.s, t.b]), [['한국어를', '한국어'], ['공부해요', '공부해요']]);
    assert.equal(tokens[0].f[0].r, 'hangugeoreul', 'the ruby is the whole word as said');
    assert.equal(bases('물이 차가워요', 'ko', dict)[0], '물');
    assert.equal(bases('학교에서', 'ko', dict)[0], '학교');
    assert.equal(bases('학생은', 'ko', dict)[0], '학생');
});

test('a Korean compound the dictionary has in parts comes apart', () => {
    const dict = fake(['삼성', '전자']);
    assert.deepEqual(bases('삼성전자', 'ko', dict), ['삼성', '전자']);
});

test('Chinese: longest match first, pinyin from the dictionary, one character when nothing matches', () => {
    const dict = fake(['我', '愛', '中文', '中國', '人'], { 中文: 'zhōngwén', 中國: 'zhōngguó' });
    const line = '我愛中文。';
    const tokens = words(line, 'cmn', dict);
    assert.deepEqual(tokens.map((t) => [t.s, t.b]), [['我', '我'], ['愛', '愛'], ['中文', '中文']]);
    assert.equal(tokens[2].f[0].r, 'zhōngwén');
    assert.equal(tokens[0].f, undefined, 'no reading in the dictionary, no ruby');
    // 中國人 is not a headword, but 中國 and 人 are
    assert.deepEqual(bases('中國人', 'cmn', dict), ['中國', '人']);
    // a character nothing knows is still a word you can click
    assert.deepEqual(bases('龍', 'cmn', dict), ['龍']);
});

test('a spaced language splits on spaces and lets the dictionary take a suffix off', () => {
    const dict = fake(['ház', 'Haus', 'gehen']);
    // Hause is the dative of Haus: the dictionary word is what gets saved
    assert.deepEqual(bases('Ich gehe nach Hause.', 'de', dict), ['Ich', 'gehe', 'nach', 'Haus']);
    assert.deepEqual(bases('házban', 'hu', dict), ['ház'], 'the stem is the word, the surface stays whole');
    assert.deepEqual(words('házban', 'hu', dict).map((t) => t.s), ['házban']);
});

test('Thai: ICU finds the words, and a vowel sign stays with its word', () => {
    const dict = fake(['ภาษา', 'ไทย', 'มาก']);
    const line = 'ภาษาไทยดีมาก';
    const tokens = words(line, 'th', dict);
    assert.equal(joined(line, 'th', dict), line);
    assert.equal(tokens[0].s, 'ภาษา');
    assert.equal(tokens[1].s, 'ไทย');
    assert.equal(tokens[tokens.length - 1].s, 'มาก', 'no word is left as a bare vowel sign');
    for (const t of tokens) assert.ok(t.s.length > 0);
});

test('a line comes back exactly as it went in, whatever the language', () => {
    const dict = fake(['한국어', '中文', 'Haus']);
    for (const [line, lang] of [
        ['한국어를 공부해요. 그리고…', 'ko'],
        ['我愛中文，你 好！', 'cmn'],
        ['Das Haus ist groß. 2 + 2 = 4', 'de'],
        ['Привет, мир!\nкак дела?', 'ru'],
        ['ภาษาไทยดีมาก ครับ!', 'th'],
        ['', 'ko'],
    ]) {
        assert.equal(joined(line, lang, dict), line, line);
    }
});

test('a Korean dictionary in Settings is what Korean splits with (and the popup finds)', async () => {
    const zip = new AdmZip();
    zip.addFile('index.json', Buffer.from(JSON.stringify({ title: 'Test 한국어', revision: '2025.01', format: 3, sourceLanguage: 'ko' })));
    zip.addFile('term_bank_1.json', Buffer.from(JSON.stringify([
        ['한국어', 'hangug-eo', 'n', '', 10, ['Korean language'], 1, ''],
        ['공부', 'gongbu', 'n', '', 5, ['study'], 2, ''],
    ])));
    await upload(zip.toBuffer(), 'ko');
    const res = await fetch(base + '/tokenize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: ['한국어를 공부해요'], lang: 'ko' }),
    });
    assert.equal(res.status, 200, 'no waiting for a tokenizer that this language does not have');
    const [tokens] = (await res.json()).tokens;
    assert.equal(tokens[0].b, '한국어', 'the particle came off, the dictionary word is the one saved');
    assert.equal(tokens[0].f[0].r, 'hangugeoreul');

    const popup = await (await fetch(base + `/dict?q=${encodeURIComponent('한국어')}&lang=ko`)).json();
    assert.equal(popup.entries.length, 0, 'there is no JMdict for Korean');
    assert.equal(popup.more[0].title, 'Test 한국어');
    assert.match(popup.more[0].entries[0].html.join(' '), /Korean language/);
});
