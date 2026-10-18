// The browser extension and akko's pages keep in step through server/companion.js: word statuses
// go straight into the shared word list (server/words.js), the rest goes to a log that every akko
// window reads from where it got to, and the extension sees the word list and akko's Anki settings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

test('the extension logs, akko windows catch up, the word list goes back out', async () => {
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-companion-'));
  process.env.AKKO_EXTENSION = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-extension-'));
  fs.writeFileSync(path.join(process.env.AKKO_EXTENSION, 'manifest.json'), JSON.stringify({ version: '9.9.9' }));
  for (const m of ['../server/paths', '../server/companion', '../server/words']) delete require.cache[require.resolve(m)];
  const companion = require('../server/companion');
  const words = require('../server/words');
  words.apply('ja', { 猫: 'known', 犬: 'learning' });
  const app = express();
  app.use('/api/companion', companion.router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/companion`;
  const json = (url, method = 'GET', body) => fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    // akko sends its list
    let log = await json(`${base}/log`);
    assert.deepEqual(log.entries, []);
    assert.equal((await json(`${base}/app`, 'PUT', { anki: { deck: 'D', model: 'M' }, native: 'pt' })).ok, true);

    // the extension: a status, a mined word, some time, and things that don't belong
    const added = await json(`${base}/log`, 'POST', { entries: [
      { kind: 'status', lemma: '犬', status: 'known' },
      { kind: 'status', lemma: '鳥', status: 'learning' },
      { kind: 'mined', item: { word: '鳥', reading: 'とり', sentence: '鳥が飛ぶ', url: 'https://www.youtube.com/watch?v=x', extra: 'dropped' } },
      { kind: 'time', day: '2026-10-12', seconds: 120, site: 'youtube', key: 'k', title: 'a video', url: 'https://www.youtube.com/watch?v=x' },
      { kind: 'status', lemma: '魚', status: 'loved' },
      { kind: 'time', day: 'today', seconds: 60 },
      { kind: 'time', day: '2026-10-12', seconds: 99999 },
      { kind: 'nonsense' },
    ] });
    assert.equal(added.added, 4, 'only the 4 good entries');

    // the statuses are in the word list at once; the extension sees it, and akko's Anki settings
    const seen = await json(`${base}?from=extension`);
    assert.deepEqual(seen.words, { 猫: 'known', 犬: 'known', 鳥: 'learning' });
    assert.deepEqual(seen.anki, { deck: 'D', model: 'M' });
    assert.equal(seen.native, 'pt');
    assert.ok(seen.seen > 0, 'akko knows the extension is there');

    // an akko window catches up from where it was
    log = await json(`${base}/log?after=${log.last}&epoch=${log.epoch}`);
    assert.equal(log.entries.length, 2, 'statuses went to the word list, not the log');
    assert.deepEqual(log.entries.map((e) => e.kind), ['mined', 'time']);
    const mined = log.entries[0].item;
    assert.equal(mined.word, '鳥');
    assert.equal(mined.lang, 'ja');
    assert.equal(mined.extra, undefined, 'only known fields are kept');
    assert.ok(mined.id && mined.added);
    // a window that knows another epoch (the file was started again) gets everything
    assert.equal((await json(`${base}/log?after=999&epoch=old`)).entries.length, 2);
    // nothing new after the last one
    assert.equal((await json(`${base}/log?after=${log.last}&epoch=${log.epoch}`)).entries.length, 0);

    // "new" removes the word
    await json(`${base}/log`, 'POST', { entries: [{ kind: 'status', lemma: '猫', status: 'new' }] });
    assert.deepEqual((await json(base)).words, { 犬: 'known', 鳥: 'learning' });

    // it's all saved
    companion.reset();
    assert.equal((await json(`${base}/log?after=0&epoch=${log.epoch}`)).entries.length, 2);
    assert.ok(fs.existsSync(companion.FILE));
    assert.equal((await json(`${base}/app`, 'PUT', { anki: [1] })).status, 400);

    // the extension's folder (for Chrome's "Load unpacked"): its version, and only the computer opens it
    const info = await json(`${base}/extension`);
    assert.equal(info.folder, process.env.AKKO_EXTENSION);
    assert.equal(info.version, '9.9.9');
    const phone = express();
    phone.use((req, res, next) => { req.viaLan = true; next(); });
    phone.use('/api/companion', companion.router);
    const lan = await new Promise((r) => { const s = phone.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const pbase = `http://127.0.0.1:${lan.address().port}/api/companion`;
      assert.equal((await json(`${pbase}/extension`)).folder, null, "a phone isn't told where things are on the computer");
      assert.equal((await json(`${pbase}/extension/open`, 'POST', {})).status, 403);
    } finally { lan.close(); }
  } finally {
    server.close();
    words.reset();
    for (const m of ['../server/paths', '../server/companion', '../server/words']) delete require.cache[require.resolve(m)];
  }
});
