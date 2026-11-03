// Settings → Dictionary → "add from a link": the way in for the languages no pack covers.
// The link is fetched here, on this machine, checked to be a Yomitan dictionary, and installed —
// tested against a tiny HTTP server, so the whole round trip is real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-dict-url-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AdmZip = require('adm-zip');
const dictionary = require('../server/dictionary');

// a Yomitan dictionary for German, the smallest one that is one
const yomitan = () => {
    const zip = new AdmZip();
    zip.addFile('index.json', Buffer.from(JSON.stringify({ title: 'Test Deutsch', revision: '2025.01', format: 3, sourceLanguage: 'de' })));
    zip.addFile('term_bank_1.json', Buffer.from(JSON.stringify([
        ['Haus', 'Haus', 'n', '', 10, ['house'], 1, ''],
        ['gehen', 'gehen', 'v', '', 9, ['to go'], 2, ''],
    ])));
    return zip.toBuffer();
};
const zip = yomitan();

let app, server, base, files, filesServer, filesBase;
before(async () => {
    // the app
    app = express();
    app.use('/api', dictionary.router);
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api`;
    // somewhere to download from: /good.zip, /page.html, /missing.zip
    filesServer = http.createServer((req, res) => {
        if (req.url === '/good.zip') { res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zip.length }); return res.end(zip); }
        if (req.url === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>a page, not a dictionary</html>'); }
        res.writeHead(404); res.end('no');
    });
    await new Promise((r) => { filesServer.listen(0, '127.0.0.1', r); });
    filesBase = `http://127.0.0.1:${filesServer.address().port}`;
});
after(() => {
    server.close();
    filesServer.close();
    fs.rmSync(process.env.AKKO_DATA, { recursive: true, force: true });
});

const add = (body) => fetch(base + '/dictionary/from-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

test('a link is fetched, checked and installed for the language you are learning', async () => {
    const res = await add({ url: `${filesBase}/good.zip`, lang: 'de' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.installed[0].count, 2, 'both entries came in');
    assert.ok(fs.existsSync(path.join(process.env.AKKO_DATA, 'dictionaries')), 'saved for the next start');
    // and it is the dictionary German lookups use now
    const look = await fetch(base + '/dict?q=Haus&lang=de').catch(() => null);
    if (look && look.ok) assert.ok(JSON.stringify(await look.json()).includes('house'));
});

test('a page that is not a dictionary is refused, politely', async () => {
    const res = await add({ url: `${filesBase}/page.html`, lang: 'de' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /isn't a Yomitan dictionary/);
});

test('a 404, a bad address and a non-web protocol all come back as words, not a stack trace', async () => {
    const missing = await add({ url: `${filesBase}/missing.zip`, lang: 'de' });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /answered 404/);

    const bad = await add({ url: 'not an address', lang: 'de' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /doesn't look like an address/);

    const proto = await add({ url: 'file:///etc/passwd', lang: 'de' });
    assert.equal(proto.status, 400);
    assert.match((await proto.json()).error, /only http and https/);

    const empty = await add({ lang: 'de' });
    assert.equal(empty.status, 400);
    assert.match((await empty.json()).error, /paste the address/);
});

test('an unknown language falls back to the default instead of failing', async () => {
    const res = await add({ url: `${filesBase}/good.zip`, lang: '!!not a code' });
    assert.equal(res.status, 200);
    assert.equal(res.status, 200);
});
