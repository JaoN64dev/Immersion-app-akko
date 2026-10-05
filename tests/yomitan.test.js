// More dictionaries (server/dictionaries.js): Yomitan .zip files added in Settings show in the word
// popup under JMdict, in your order; and a dictionary file can't put anything unsafe into the page.
// Runs on an empty, temporary data folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-yomitan-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AdmZip = require('adm-zip');
const dictionary = require('../server/dictionary');
const dictionaries = require('../server/dictionaries');

const zipOf = (files) => {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(files)) zip.addFile(name, Buffer.from(JSON.stringify(data)));
  return zip.toBuffer();
};

// Jitendex-like: structured content, with things that must not reach the page
const jitendex = (revision, gloss) => zipOf({
  'index.json': { title: 'Test Jitendex', revision, format: 3, sourceLanguage: 'ja' },
  'tag_bank_1.json': [['n', 'partOfSpeech', 0, 'noun', 0]],
  'term_bank_1.json': [
    ['猫', 'ねこ', 'n', '', 10, [
      { type: 'structured-content', content: [
        { tag: 'ul', data: { content: 'glossary' }, content: [{ tag: 'li', content: gloss }, { tag: 'li', content: 'kitty' }] },
        { tag: 'a', href: 'javascript:alert(1)', content: 'see 犬' },
        { tag: 'script', content: 'alert(1)' },
        { tag: 'img', path: 'x.png' },
        { tag: 'span', lang: 'ja" onmouseover="alert(1)', data: { x: '"><script>' }, style: { color: 'red' }, content: '<b>not bold</b>' },
      ] },
    ], 1, ''],
    ['猫', 'ねこ', '', '', 1, ['a second, less common meaning'], 2, ''],
  ],
});

// format 1 (old Yomichan): meanings are the rest of the row
const monolingual = zipOf({
  'index.json': { title: '国語テスト', revision: 'v1', version: 1 },
  'term_bank_1.json': [['猫', 'ねこ', '', '', 0, 'ネコ科の小形の哺乳類。']],
});

let server, base;
before(async () => {
  const app = express();
  app.use('/api/dictionaries', dictionaries.router);
  app.use('/api', dictionary.router);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  // a tiny JMdict, so /api/dict answers offline
  const jm = { dictDate: '2099-01-01', tags: {}, words: [{ kanji: [{ text: '猫', tags: [], common: true }], kana: [{ text: 'ねこ', tags: [], common: true }], sense: [{ partOfSpeech: ['n'], gloss: [{ text: 'cat' }], misc: [] }] }] };
  await fetch(base + '/dictionary/upload', { method: 'POST', body: JSON.stringify(jm) });
});
after(() => {
  server.close();
  fs.rmSync(process.env.AKKO_DATA, { recursive: true, force: true });
});

const upload = async (buf, lang = 'ja') => {
  const res = await fetch(`${base}/dictionary/upload?lang=${lang}`, { method: 'POST', body: buf });
  return { status: res.status, body: await res.json() };
};
const popup = async (q) => (await fetch(`${base}/dict?q=${encodeURIComponent(q)}`)).json();
const list = async () => (await (await fetch(base + '/dictionaries')).json()).dictionaries;

test('a Yomitan dictionary is added (not replacing JMdict) and shows under JMdict', async () => {
  const { status, body } = await upload(jitendex('2024.01', 'cat'));
  assert.equal(status, 200);
  assert.deepEqual(body.installed, [{ kind: 'dictionary', title: 'Test Jitendex', revision: '2024.01', count: 2, replaced: false }]);
  assert.equal(body.words.version, '2099-01-01', 'JMdict is still there');

  const r = await popup('猫');
  assert.equal(r.entries[0].senses[0].gloss[0], 'cat', 'JMdict first');
  assert.equal(r.more.length, 1);
  assert.equal(r.more[0].title, 'Test Jitendex');
  const [first, second] = r.more[0].entries;
  assert.equal(first.reading, 'ねこ');
  assert.deepEqual(first.tags, ['n']);
  assert.match(second.html[0], /less common/, 'sorted by score');
});

test("a dictionary file can't put anything unsafe into the page", async () => {
  const html = (await popup('猫')).more[0].entries[0].html.join('');
  assert.match(html, /<ul class="yd-glossary"><li>cat<\/li><li>kitty<\/li><\/ul>/, 'lists and data names kept');
  assert.match(html, /see 犬/, "a link's text is kept…");
  assert.doesNotMatch(html, /<a|href|javascript/, '…but not the link');
  assert.doesNotMatch(html, /<script|<img|onmouseover|style=/);
  assert.match(html, /&lt;b&gt;not bold&lt;\/b&gt;/, 'text is escaped');
  assert.doesNotMatch(html, /alert\(1\)/);
});

test('several dictionaries: order, on/off, other language', async () => {
  assert.equal((await upload(monolingual)).status, 200);
  assert.deepEqual((await popup('猫')).more.map((d) => d.title), ['Test Jitendex', '国語テスト']);

  const ids = (await list()).map((d) => d.id);
  await fetch(base + '/dictionaries/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...ids].reverse() }) });
  assert.deepEqual((await popup('猫')).more.map((d) => d.title), ['国語テスト', 'Test Jitendex']);

  await fetch(`${base}/dictionaries/${ids[0]}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  assert.deepEqual((await popup('猫')).more.map((d) => d.title), ['国語テスト'], 'turned off');

  // an English dictionary only shows when learning English
  const english = zipOf({ 'index.json': { title: 'Test English', revision: '1', format: 3 }, 'term_bank_1.json': [['cat', '', '', '', 0, ['a small furry animal'], 1, '']] });
  assert.equal((await upload(english, 'en')).status, 200);
  assert.equal((await list()).find((d) => d.title === 'Test English').lang, 'en');
  assert.ok(!(await popup('猫')).more.some((d) => d.title === 'Test English'));
  const en = await (await fetch(`${base}/dict?q=Cat&lang=en`)).json();
  assert.ok(en.more.some((d) => d.title === 'Test English'), 'found, also from "Cat"');
});

test('adding the same title again updates it; removing deletes its files', async () => {
  const { body } = await upload(jitendex('2025.01', 'cat (new)'));
  assert.equal(body.installed[0].replaced, true);
  const d = (await list()).find((x) => x.title === 'Test Jitendex');
  assert.equal(d.revision, '2025.01');
  assert.equal(d.enabled, false, 'keeps being off');
  assert.equal((await list()).filter((x) => x.title === 'Test Jitendex').length, 1);

  const res = await fetch(`${base}/dictionaries/${d.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(path.join(process.env.AKKO_DATA, 'dictionaries', d.id)));
  assert.ok(!(await list()).some((x) => x.title === 'Test Jitendex'));
});

test('a newer version with a dated title (like Jitendex) replaces the old one, matched by its update address', async () => {
  const version = (date) => zipOf({
    'index.json': { title: `Dated [${date}]`, revision: date, format: 3, indexUrl: 'https://example.org/dated.json' },
    'term_bank_1.json': [['猫', 'ねこ', '', '', 0, [`cat (${date})`], 1, '']],
  });
  await upload(version('2026-09-01'));
  const { body } = await upload(version('2026-10-01'));
  assert.equal(body.installed[0].replaced, true);
  const dated = (await list()).filter((d) => d.title.startsWith('Dated'));
  assert.deepEqual(dated.map((d) => d.title), ['Dated [2026-10-01]']);
});

test('a frequency list adds a rank to each entry (all of Yomitan\'s value formats)', async () => {
  const freq = zipOf({
    'index.json': { title: 'JPDB v2 Frequency', revision: '1', format: 3 },
    'term_meta_bank_1.json': [
      ['猫', 'freq', { reading: 'ねこ', frequency: { value: 1500, displayValue: '1500㋕' } }],
      ['猫', 'freq', { reading: 'ねこま', frequency: 90000 }],
      ['犬', 'freq', 2000],
      ['鳥', 'freq', '3000'],
      ['鳥', 'pitch', { reading: 'とり', pitches: [{ position: 0 }] }],       // not a frequency: skipped
    ],
  });
  const { status, body } = await upload(freq);
  assert.equal(status, 200);
  assert.equal(body.installed[0].count, 4);
  assert.equal((await list()).find((d) => d.title === 'JPDB v2 Frequency').kind, 'freq');

  const r = await popup('猫');
  assert.deepEqual(r.entries[0].freq, [{ title: 'JPDB v2 Frequency', value: '1500㋕' }], 'the rank for its reading (ねこ), as the list shows it');
  assert.ok(!r.more.some((d) => d.title === 'JPDB v2 Frequency'), 'a frequency list is not a definitions block');

  const { frequencies } = dictionaries;
  assert.deepEqual(frequencies([{ word: '犬', reading: 'いぬ' }, { word: '鳥', reading: 'とり' }, { word: '魚', reading: 'さかな' }], 'ja'),
    [[{ title: 'JPDB v2 Frequency', value: '2000' }], [{ title: 'JPDB v2 Frequency', value: '3000' }], []]);
});

test('pitch accent and kanji-only dictionaries are refused with a reason', async () => {
  const pitch = zipOf({ 'index.json': { title: 'Pitch', revision: '1', format: 3 }, 'term_meta_bank_1.json': [['猫', 'pitch', { reading: 'ねこ', pitches: [{ position: 1 }] }]] });
  const { status, body } = await upload(pitch);
  assert.equal(status, 400);
  assert.match(body.error, /no frequencies|pitch accent/);
  const kanji = zipOf({ 'index.json': { title: 'Kanji', revision: '1', format: 3 }, 'kanji_bank_1.json': [['猫', 'ビョウ', 'ねこ', '', ['cat'], {}]] });
  assert.match((await upload(kanji)).body.error, /no word definitions or frequencies/);
  const noTitle = zipOf({ 'index.json': { revision: '1' }, 'term_bank_1.json': [] });
  assert.match((await upload(noTitle)).body.error, /no title/);
});
