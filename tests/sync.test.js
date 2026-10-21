// Everything else in step (server/sync.js): the last change wins per record, deletions reach the
// others, a page catches up from where it was, time is per device, recordings come and go with
// their mined words.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

test('collections: last change wins, tombstones, catching up, time per device, recordings', async () => {
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-sync-'));
  for (const m of ['../server/paths', '../server/sync']) delete require.cache[require.resolve(m)];
  const sync = require('../server/sync');
  const app = express();
  app.use('/api/sync', sync.router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/sync`;
  const post = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const T = Date.now();                 // tombstones older than 120 days go: times near now
  const byKey = (list) => Object.fromEntries(list.map((c) => [c.k, c]));
  try {
    // device A, first time: its records
    let a = await post({ id: '', collections: { progress: { since: 0, changes: [
      { k: 'video1', value: { time: 30 }, updated: T + 1000 },
      { k: 'video2', value: { time: 5 }, updated: T + 1000 },
    ] } } });
    const id = a.id;
    assert.ok(id);
    assert.equal(a.collections.progress.changes.length, 2);
    const aSince = a.collections.progress.v;

    // device B, first time: an older video1 loses, its own video3 is added; it gets everything
    let b = await post({ id: '', collections: { progress: { since: 0, changes: [
      { k: 'video1', value: { time: 10 }, updated: T + 500 },
      { k: 'video3', value: { time: 99 }, updated: 1 },
    ] } } });
    let got = byKey(b.collections.progress.changes);
    assert.deepEqual(got.video1.value, { time: 30 }, "the newer one stays");
    assert.deepEqual(got.video3.value, { time: 99 });

    // B moves on in video1 and deletes video2
    b = await post({ id, collections: { progress: { since: b.collections.progress.v, changes: [
      { k: 'video1', value: { time: 60 }, updated: T + 2000 },
      { k: 'video2', deleted: true, updated: T + 2000 },
    ] } } });

    // A catches up: only what changed since its last sync
    a = await post({ id, collections: { progress: { since: aSince, changes: [] } } });
    got = byKey(a.collections.progress.changes);
    assert.deepEqual(Object.keys(got).sort(), ['video1', 'video2', 'video3']);
    assert.deepEqual(got.video1.value, { time: 60 });
    assert.equal(got.video2.deleted, true);
    // and nothing more next time
    assert.equal((await post({ id, collections: { progress: { since: a.collections.progress.v, changes: [] } } })).collections.progress.changes.length, 0);

    // a page that knows another server (a new data folder) gets everything, tombstones too
    const fresh = await post({ id: 'old', collections: { progress: { since: 999, changes: [] } } });
    assert.equal(fresh.collections.progress.changes.length, 3);
    // a bad collection name is ignored
    assert.equal((await post({ id, collections: { '../x': { since: 0, changes: [] } } })).collections['../x'], undefined);

    // the extension's time: a device of its own, added up
    sync.addSeconds('ja', 'extension', '2026-10-12', 60);
    sync.addSeconds('ja', 'extension', '2026-10-12', 30);
    sync.addSeconds('en', 'extension', '2026-10-12', 15);
    const days = await post({ id, collections: { days: { since: 0, changes: [{ k: 'deviceA', value: { '2026-10-12': 600 }, updated: T + 5 }] }, 'days-en': { since: 0, changes: [] } } });
    const d = byKey(days.collections.days.changes);
    assert.deepEqual(d.extension.value, { '2026-10-12': 90 });
    assert.deepEqual(d.deviceA.value, { '2026-10-12': 600 });
    assert.deepEqual(days.collections['days-en'].changes[0].value, { '2026-10-12': 15 });

    // recordings: kept, listed, sent back; gone with their mined word
    await post({ id, collections: { mined: { since: 0, changes: [{ k: 'm1', value: { id: 'm1', word: '猫' }, updated: T + 10 }] } } });
    const put = await fetch(`${base}/media/m1/audio`, { method: 'PUT', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.from('fake audio') });
    assert.equal(put.status, 200);
    assert.equal((await fetch(`${base}/media/m1/audio`, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: '<b>' })).status, 400);
    assert.deepEqual((await post({ id, collections: {}, media: true })).media, ['m1']);
    const back = await fetch(`${base}/media/m1/audio`);
    assert.equal(back.headers.get('content-type'), 'audio/webm');
    assert.equal(await back.text(), 'fake audio');
    await post({ id, collections: { mined: { since: 0, changes: [{ k: 'm1', deleted: true, updated: T + 20 }] } } });
    assert.deepEqual((await post({ id, collections: {}, media: true })).media, []);
    assert.equal((await fetch(`${base}/media/m1/audio`)).status, 404);

    // it's all saved
    sync.reset();
    const again = await post({ id, collections: { progress: { since: 0, changes: [] } } });
    assert.equal(again.id, id);
    assert.deepEqual(byKey(again.collections.progress.changes).video1.value, { time: 60 });
  } finally {
    server.close();
    sync.reset();
    for (const m of ['../server/paths', '../server/sync']) delete require.cache[require.resolve(m)];
  }
});
