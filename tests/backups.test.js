// Automatic backups (server/backups.js): saved in the data folder, only the last 10 kept, only
// akko backups accepted, and only those files can be read back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

test('backups are kept (the last 10), listed newest first, and read back', async () => {
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-backups-'));
  for (const m of ['../server/paths', '../server/backups']) delete require.cache[require.resolve(m)];
  const { router, DIR } = require('../server/backups');
  const app = express();
  app.use('/api/backups', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/backups`;
  try {
    const post = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal((await post('{"hello": 1}')).status, 400, 'not an akko backup');
    const names = [];
    for (let i = 0; i < 12; i++) {
      const r = await post(JSON.stringify({ app: 'akko-immersion', version: 3, n: i, data: {}, idb: {} }));
      assert.equal(r.status, 200);
      names.push((await r.json()).name);
    }
    const { folder, backups } = await (await fetch(base)).json();
    assert.equal(folder, DIR);
    assert.equal(backups.length, 10, 'only the last 10 are kept');
    assert.equal(fs.readdirSync(DIR).length, 10);
    const newest = await (await fetch(`${base}/${backups[0].name}`)).json();
    assert.equal(newest.n, 11);
    assert.ok(!backups.some((b) => b.name === names[0]), 'the oldest went');
    // nothing else in (or outside) the folder can be read
    fs.writeFileSync(path.join(DIR, 'notes.txt'), 'x');
    for (const bad of ['notes.txt', '..%2Fpaths.js', 'akko-auto-x.json']) assert.equal((await fetch(`${base}/${bad}`)).status, 404, bad);
  } finally {
    server.close();
    for (const m of ['../server/paths', '../server/backups']) delete require.cache[require.resolve(m)];
  }
});
