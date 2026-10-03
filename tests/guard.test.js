// Other websites open in the browser must not be able to change anything through akko's server
// (server/guard.js), while akko's own pages, and programs on this computer, still can.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { guard } = require('../server/guard');

let server, port;
before(async () => {
  const app = express();
  app.use(guard);
  app.all('/api/x', (req, res) => res.json({ ok: true }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(() => server.close());

// http.request instead of fetch: fetch won't let us set Host
const ask = (method, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/api/x', method, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

test("akko's own pages can change things", async () => {
  assert.equal(await ask('POST', { Origin: `http://127.0.0.1:${port}` }), 200);
  assert.equal(await ask('POST', { Host: `localhost:${port}`, Origin: `http://localhost:${port}` }), 200);
});

test('programs on this computer (no Origin) still work', async () => {
  assert.equal(await ask('POST'), 200);
  assert.equal(await ask('GET'), 200);
});

test('other websites cannot change anything', async () => {
  for (const origin of ['https://evil.example', `http://localhost:${port}`, 'null']) {
    assert.equal(await ask('POST', { Origin: origin }), 403, origin);
    assert.equal(await ask('PUT', { Origin: origin }), 403, origin);
    assert.equal(await ask('DELETE', { Origin: origin }), 403, origin);
  }
});

test('another name pointed at 127.0.0.1 (DNS rebinding) gets nothing', async () => {
  assert.equal(await ask('GET', { Host: `evil.example:${port}` }), 403);
  assert.equal(await ask('POST', { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` }), 403);
});
