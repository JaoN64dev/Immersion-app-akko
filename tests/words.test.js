// One word list for every akko window, phone and the extension (server/words.js): pages merge
// their list in the first time, then send their changes and get the others'.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

test('the shared word list: merging in, catching up, restoring a backup, bad input', async () => {
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-words-'));
  for (const m of ['../server/paths', '../server/words']) delete require.cache[require.resolve(m)];
  const words = require('../server/words');
  const app = express();
  app.use('/api/words', words.router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/words`;
  const sync = (body) => fetch(`${base}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    // the desktop app joins first with its list
    const a = await sync({ lang: 'ja', id: '', since: 0, merge: { words: { 猫: 'known', 犬: 'learning' }, prefer: 'server' } });
    assert.deepEqual(a.full, { 猫: 'known', 犬: 'learning' });
    // the phone joins with a different list: new words added, the server's status kept for 猫
    const b = await sync({ lang: 'ja', id: '', since: 0, merge: { words: { 猫: 'learning', 鳥: 'known' }, prefer: 'server' } });
    assert.deepEqual(b.full, { 猫: 'known', 犬: 'learning', 鳥: 'known' });

    // the phone marks a word; the desktop app catches up with just that change
    const b2 = await sync({ lang: 'ja', id: b.id, since: b.v, changes: { 犬: 'known' } });
    assert.equal(b2.v, b.v + 1);
    const a2 = await sync({ lang: 'ja', id: a.id, since: a.v, changes: {} });
    assert.deepEqual(a2.changes, { 鳥: 'known', 犬: 'known' }, 'only what changed since its last sync');
    assert.equal(a2.full, undefined);
    // nothing new: nothing comes back
    assert.deepEqual((await sync({ lang: 'ja', id: a.id, since: a2.v, changes: {} })).changes, {});
    // "new" takes a word out
    await sync({ lang: 'ja', id: a.id, since: a2.v, changes: { 鳥: 'new' } });
    assert.equal((await (await fetch(`${base}?lang=ja`)).json()).words.鳥, undefined);

    // a backup restored on one page: its list wins
    const r = await sync({ lang: 'ja', id: '', since: 0, merge: { words: { 猫: 'learning' }, prefer: 'local' } });
    assert.equal(r.full.猫, 'learning');
    assert.equal(r.full.犬, 'known', 'words the backup doesn\'t have stay');

    // a page from another list (the file was replaced) gets the whole list
    assert.ok((await sync({ lang: 'ja', id: 'someone-else', since: 3, changes: {} })).full);
    // English is separate
    const en = await sync({ lang: 'en', id: '', since: 0, merge: { words: { cat: 'known' }, prefer: 'server' } });
    assert.deepEqual(en.full, { cat: 'known' });
    assert.equal((await (await fetch(`${base}?lang=ja`)).json()).words.cat, undefined);

    // nonsense is ignored
    const bad = await sync({ lang: 'ja', id: r.id, since: r.v, changes: { '': 'known', 象: 'loved', [`${'あ'.repeat(200)}`]: 'known' } });
    assert.deepEqual(bad.changes, {});
    assert.equal((await sync({ lang: 'xx', changes: {} })).status, 400);

    // saved
    words.reset();
    assert.equal((await (await fetch(`${base}?lang=ja`)).json()).words.猫, 'learning');
    assert.ok(fs.existsSync(words.FILE));
  } finally {
    server.close();
    words.reset();
    for (const m of ['../server/paths', '../server/words']) delete require.cache[require.resolve(m)];
  }
});
