// Diagnostics and reports (server/diagnostics.js): nothing personal in the messages, the computer
// alone sees the diagnostics, a report goes to the report service, or comes back as a GitHub issue
// to send by hand.
process.env.AKKO_OFFLINE = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const express = require('express');
const diagnostics = require('../server/diagnostics');

const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const json = (url, body) => fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, ...(await r.json()) }));

test('messages lose the home folder, the user name and e-mail addresses', () => {
  const home = os.homedir();
  const s = diagnostics.redact(`couldn't read ${home}${home.includes('\\') ? '\\' : '/'}Videos/x.mkv, write to me@example.com`);
  assert.ok(!s.includes(home), s);
  assert.ok(s.includes('~'), s);
  assert.ok(s.includes('<email>') && !s.includes('example.com'), s);
});

test('a GitHub issue to send by hand: filled in, never too long, no contact address', () => {
  const recent = Array.from({ length: 100 }, (_, i) => ({ at: 'x', level: 'warn', text: `message ${i} `.repeat(30) }));
  const url = diagnostics.issueUrl({ what: 'the popup is empty', expected: 'a meaning', steps: '', contact: 'me@example.com', diagnostics: { version: '2.0.0', recent } });
  assert.ok(url.length <= 7800, String(url.length));
  const q = new URL(url).searchParams;
  assert.equal(q.get('title'), 'the popup is empty');
  assert.match(q.get('body'), /a meaning/);
  assert.match(q.get('body'), /2\.0\.0/);
  assert.ok(!q.get('body').includes('me@example.com'));
});

test('reports: to the service when there is one, else the GitHub issue; diagnostics for the computer only', async () => {
  // a stand-in for akko's report service
  const got = [];
  const cloud = express();
  cloud.post('/report', express.json({ limit: '5mb' }), (req, res) => { got.push(req.body); res.json({ issue: 'https://github.com/x/y/issues/1' }); });
  const cs = await listen(cloud);
  const app = express();
  app.use('/api', diagnostics.router);
  const s = await listen(app);
  const phone = express();
  phone.use((req, res, next) => { req.viaLan = true; next(); });
  phone.use('/api', diagnostics.router);
  const ps = await listen(phone);
  const base = `http://127.0.0.1:${s.address().port}/api`;
  try {
    delete process.env.AKKO_CLOUD;
    const d = await json(`${base}/diagnostics`);
    assert.equal(d.version, require('../package.json').version);
    assert.ok(Array.isArray(d.recent));
    assert.equal((await json(`http://127.0.0.1:${ps.address().port}/api/diagnostics`)).status, 403, 'not for a phone');

    assert.equal((await json(`${base}/report`, { what: '' })).status, 400);
    const offline = await json(`${base}/report`, { what: 'it broke', contact: 'me@example.com' });
    assert.equal(offline.sent, false);
    assert.match(offline.issueUrl, /^https:\/\/github\.com\/JaoN64dev\/Immersion-app-akko\/issues\/new\?/);

    process.env.AKKO_CLOUD = `http://127.0.0.1:${cs.address().port}/`;
    const sent = await json(`${base}/report`, { what: 'it broke', error: `at ${os.homedir()}`, contact: 'me@example.com', picture: 'data:image/png;base64,AAAA', extra: 'dropped' });
    assert.equal(sent.sent, true);
    assert.equal(sent.issue, 'https://github.com/x/y/issues/1');
    assert.equal(got.length, 1);
    assert.equal(got[0].what, 'it broke');
    assert.equal(got[0].contact, 'me@example.com', 'the service keeps it private');
    assert.ok(!got[0].error.includes(os.homedir()));
    assert.equal(got[0].extra, undefined);
    assert.equal(got[0].app, 'akko');
  } finally {
    delete process.env.AKKO_CLOUD;
    s.close(); cs.close(); ps.close();
  }
});
