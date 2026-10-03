// Settings → Dictionary: uploading a JMdict / KANJIDIC2 file from jmdict-simplified replaces the
// dictionary straight away. Runs on an empty, temporary data folder, so the real one isn't touched.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-dict-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AdmZip = require('adm-zip');
const dictionary = require('../server/dictionary');

// a tiny JMdict in the jmdict-simplified format
const jmdict = (date, gloss) => ({
  dictDate: date,
  tags: { n: 'noun (common) (futsuumeishi)' },
  words: [{
    kanji: [{ text: '猫', tags: [], common: true }],
    kana: [{ text: 'ねこ', tags: [], common: true }],
    sense: [{ partOfSpeech: ['n'], gloss: [{ text: gloss }], misc: [] }],
  }],
});
const kanjidic = {
  dictDate: '2099-01-01',
  characters: [{
    literal: '猫',
    readingMeaning: { groups: [{ readings: [{ type: 'ja_on', value: 'ビョウ' }, { type: 'ja_kun', value: 'ねこ' }], meanings: [{ lang: 'en', value: 'cat' }] }] },
    misc: { strokeCounts: [11], grade: 8, jlptLevel: 2 },
  }],
};
const zipOf = (name, data) => {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(JSON.stringify(data)));
  return zip.toBuffer();
};

let server, base;
before(async () => {
  const app = express();
  app.use('/api', dictionary.router);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  fs.rmSync(process.env.AKKO_DATA, { recursive: true, force: true });
});

const upload = (body) => fetch(base + '/dictionary/upload', { method: 'POST', body });

test('uploading a JMdict zip installs it and lookups use it right away', async () => {
  const res = await upload(zipOf('jmdict-eng-3.6.1.json', jmdict('2099-01-01', 'cat')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.installed, [{ kind: 'words', count: 1, version: '2099-01-01', previous: null, previousCount: 0 }]);
  assert.equal(body.words.version, '2099-01-01');
  assert.ok(fs.existsSync(path.join(process.env.AKKO_DATA, 'dict.json')), 'saved for the next start');

  const hit = await (await fetch(base + '/dict?q=猫')).json();
  assert.equal(hit.entries[0].senses[0].gloss[0], 'cat');
});

test('a newer JMdict, as a plain .json, replaces the old one', async () => {
  const res = await upload(Buffer.from(JSON.stringify(jmdict('2099-02-02', 'cat (animal)'))));
  const body = await res.json();
  assert.equal(body.installed[0].previous, '2099-01-01');
  assert.equal(body.installed[0].previousCount, 1, 'so the page can warn when the new one is much smaller');
  assert.equal(body.words.version, '2099-02-02');
  const hit = await (await fetch(base + '/dict?q=猫')).json();
  assert.equal(hit.entries[0].senses[0].gloss[0], 'cat (animal)');
});

test('uploading KANJIDIC2 replaces the kanji info', async () => {
  const body = await (await upload(zipOf('kanjidic2-en-3.6.1.json', kanjidic))).json();
  assert.deepEqual(body.installed, [{ kind: 'kanji', count: 1, version: '2099-01-01' }]);
  assert.equal(body.kanji.count, 1);
});

test('other files are refused and nothing changes', async () => {
  // a big file that isn't JSON (a video picked by mistake) is refused from its first bytes
  const video = Buffer.alloc(5e6, 0x41);
  for (const bad of [Buffer.from('hello'), video, Buffer.from('\uFEFF  [1, 2]'), zipOf('readme.txt', {}), zipOf('x.json', { something: [] })]) {
    const res = await upload(bad);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /JMdict|\.json/);
  }
  const info = await (await fetch(base + '/dictionary')).json();
  assert.equal(info.words.version, '2099-02-02', 'the installed dictionary is kept');
});
