// Using akko from a phone on the same Wi-Fi (server/lan.js): off until the computer turns it on,
// then devices need the PIN; only the computer can change the settings; a new PIN signs devices out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

// http.request so the Host and cookies can be set by hand
function ask(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) { req.setHeader('Content-Type', 'application/json'); req.end(JSON.stringify(body)); } else req.end();
  });
}

test('phone access: off by default, PIN to sign in, the computer alone changes it', async () => {
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-lan-'));
  for (const m of ['../server/paths', '../server/lan', '../server/guard']) delete require.cache[require.resolve(m)];
  const lan = require('../server/lan');
  const { guard } = require('../server/guard');
  const app = express();
  app.use(guard);
  app.use('/api/lan', lan.router);
  app.get('/lan-login', lan.loginPage);
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.send('home'));
  const main = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = main.address().port;
  const lanPort = port + 1;
  lan.start(app, port);
  try {
    // off: nothing answers on the second port
    await assert.rejects(ask(lanPort));
    // the computer turns it on
    const on = JSON.parse((await ask(port, { method: 'POST', path: '/api/lan', body: { enabled: true } })).body);
    assert.equal(on.enabled, true);
    assert.match(on.pin, /^\d{6}$/);
    await new Promise((r) => setTimeout(r, 200));

    // not signed in: pages go to the PIN page, the API says so
    const page = await ask(lanPort);
    assert.equal(page.status, 302);
    assert.match(page.headers.location, /^\/lan-login/);
    assert.equal((await ask(lanPort, { path: '/api/x' })).status, 401);
    assert.equal((await ask(lanPort, { path: '/lan-login' })).status, 200);
    // a name instead of the address (DNS rebinding) is refused
    assert.equal((await ask(lanPort, { headers: { Host: `localhost:${lanPort}` } })).status, 403);

    // the right PIN: a cookie that works
    const ok = await ask(lanPort, { method: 'POST', path: '/api/lan/login', body: { pin: on.pin } });
    assert.equal(ok.status, 200);
    const cookie = ok.headers['set-cookie'][0].split(';')[0];
    assert.match(ok.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
    assert.equal((await ask(lanPort, { path: '/api/x', headers: { Cookie: cookie } })).status, 200);
    assert.equal((await ask(lanPort, { headers: { Cookie: cookie } })).body, 'home');

    // signed in or not, a device can't change the settings or see the PIN
    assert.equal((await ask(lanPort, { path: '/api/lan', headers: { Cookie: cookie } })).status, 403);
    assert.equal((await ask(lanPort, { method: 'POST', path: '/api/lan', headers: { Cookie: cookie, Origin: `http://127.0.0.1:${lanPort}` }, body: { enabled: false } })).status, 403);

    // a new PIN signs every device out
    await ask(port, { method: 'POST', path: '/api/lan', body: { newPin: true } });
    assert.equal((await ask(lanPort, { path: '/api/x', headers: { Cookie: cookie } })).status, 401);

    // wrong PINs: five a minute, then "wait"
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await ask(lanPort, { method: 'POST', path: '/api/lan/login', body: { pin: '000000x' } })).status);
    assert.deepEqual(codes, [403, 403, 403, 403, 403, 429]);

    // turned off: the second address goes away
    await ask(port, { method: 'POST', path: '/api/lan', body: { enabled: false } });
    await new Promise((r) => setTimeout(r, 200));
    await assert.rejects(ask(lanPort));
  } finally {
    lan.close();
    main.close();
    for (const m of ['../server/paths', '../server/lan', '../server/guard']) delete require.cache[require.resolve(m)];
  }
});

test('only home-network addresses count as private', () => {
  const { isPrivate } = require('../server/lan');
  for (const ip of ['192.168.1.20', '10.0.0.5', '172.16.3.1', '172.31.255.1', '::ffff:192.168.0.9', '127.0.0.1', 'fe80::1', 'fd12::3']) assert.ok(isPrivate(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:4860::8888']) assert.ok(!isPrivate(ip), ip);
});
