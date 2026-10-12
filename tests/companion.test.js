// The browser extension and akko's pages keep in step through server/companion.js: the extension
// adds to a log, every akko window reads it from where it got to, and the extension sees akko's
// word list with the statuses akko hasn't applied yet on top.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

test('the extension logs, akko windows catch up, the word list goes back out', async () => {
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-companion-'));
  for (const m of ['../server/paths', '../server/companion']) delete require.cache[require.resolve(m)];
  const companion = require('../server/companion');
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
    assert.equal((await json(`${base}/app`, 'PUT', { words: { 猫: 'known', 犬: 'learning' }, anki: { deck: 'D', model: 'M' }, native: 'pt', epoch: log.epoch, seq: log.last })).ok, true);

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

    // the extension sees akko's list with its own statuses on top, and akko's Anki settings
    const seen = await json(`${base}?from=extension`);
    assert.deepEqual(seen.words, { 猫: 'known', 犬: 'known', 鳥: 'learning' });
    assert.deepEqual(seen.anki, { deck: 'D', model: 'M' });
    assert.equal(seen.native, 'pt');
    assert.ok(seen.seen > 0, 'akko knows the extension is there');

    // an akko window catches up from where it was
    log = await json(`${base}/log?after=${log.last}&epoch=${log.epoch}`);
    assert.equal(log.entries.length, 4);
    assert.deepEqual(log.entries.map((e) => e.kind), ['status', 'status', 'mined', 'time']);
    const mined = log.entries[2].item;
    assert.equal(mined.word, '鳥');
    assert.equal(mined.lang, 'ja');
    assert.equal(mined.extra, undefined, 'only known fields are kept');
    assert.ok(mined.id && mined.added);
    // a window that knows another epoch (the file was started again) gets everything
    assert.equal((await json(`${base}/log?after=999&epoch=old`)).entries.length, 4);
    // nothing new after the last one
    assert.equal((await json(`${base}/log?after=${log.last}&epoch=${log.epoch}`)).entries.length, 0);

    // the window applied the log and sends its list: the statuses are now in it
    await json(`${base}/app`, 'PUT', { words: { 猫: 'known', 犬: 'known', 鳥: 'learning' }, epoch: log.epoch, seq: log.last });
    // a window that's behind (older list) still shows the extension's statuses on top
    await json(`${base}/log`, 'POST', { entries: [{ kind: 'status', lemma: '猫', status: 'new' }] });
    assert.deepEqual((await json(base)).words, { 犬: 'known', 鳥: 'learning' }, '"new" removes the word');

    // it's all saved
    companion.reset();
    assert.equal((await json(`${base}/log?after=0&epoch=${log.epoch}`)).entries.length, 5);
    assert.ok(fs.existsSync(companion.FILE));
    assert.equal((await json(`${base}/app`, 'PUT', { words: [] })).status, 400);
  } finally {
    server.close();
    for (const m of ['../server/paths', '../server/companion']) delete require.cache[require.resolve(m)];
  }
});
