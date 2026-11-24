// 読む → from a URL: the page is fetched here, on this machine, and handed to the reader as HTML.
// Tested against a tiny HTTP server so the whole round trip is real — including a Shift_JIS page,
// which is what Aozora Bunko and plenty of older Japanese sites still serve.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-reader-url-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dictionary = require('../server/dictionary');

// 吾輩は猫である in Shift_JIS, written out by hand so the test needs no encoder
const SJIS_CAT = Buffer.from([0x8c, 0xe1, 0x94, 0x79, 0x82, 0xcd, 0x94, 0x4c, 0x82, 0xc5, 0x82, 0xa0, 0x82, 0xe9]);

let server, base, pages, pagesBase;
before(async () => {
    const app = express();
    app.use('/api', dictionary.router);
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api`;
    pages = http.createServer((req, res) => {
        if (req.url === '/utf8.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end('<html><head><title>猫 &amp; 犬</title></head><body><p>吾輩は猫である</p></body></html>');
        }
        if (req.url === '/sjis-header.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=Shift_JIS' });
            return res.end(Buffer.concat([Buffer.from('<html><body><p>'), SJIS_CAT, Buffer.from('</p></body></html>')]));
        }
        if (req.url === '/sjis-meta.html') {
            res.writeHead(200, { 'content-type': 'text/html' });
            return res.end(Buffer.concat([Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html;charset=Shift_JIS"></head><body><div>'), SJIS_CAT, Buffer.from('</div></body></html>')]));
        }
        if (req.url === '/huge.html') {
            res.writeHead(200, { 'content-type': 'text/html' });            // no content-length: streamed
            const chunk = Buffer.alloc(1e6, 'a');
            let sent = 0;
            const more = () => { while (sent < 8 && res.write(chunk)) sent++; if (sent < 8) res.once('drain', () => { sent++; more(); }); else res.end(); };
            return more();
        }
        res.writeHead(404); res.end();
    });
    await new Promise((r) => { pages.listen(0, '127.0.0.1', r); });
    pagesBase = `http://127.0.0.1:${pages.address().port}`;
});
after(() => { server.close(); pages.close(); });

const read = (url) => fetch(`${base}/reader/from-url`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
});

test('a UTF-8 page comes back as it is', async () => {
    const res = await read(`${pagesBase}/utf8.html`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.html, /吾輩は猫である/);
    assert.match(body.html, /<title>猫 &amp; 犬<\/title>/, 'the page decodes its own title, entities included');
});

test('a Shift_JIS page (said in the header) is decoded, not mojibake', async () => {
    const body = await (await read(`${pagesBase}/sjis-header.html`)).json();
    assert.match(body.html, /吾輩は猫である/);
});

test('a Shift_JIS page (said only in a <meta>) is decoded too', async () => {
    const body = await (await read(`${pagesBase}/sjis-meta.html`)).json();
    assert.match(body.html, /吾輩は猫である/);
});

test('a page over the ceiling is refused while it streams in', async () => {
    const res = await read(`${pagesBase}/huge.html`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /too big/);
});

test('only http and https', async () => {
    const res = await read('file:///etc/passwd');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /only http and https/);
});

test('a site that answers 404 says so', async () => {
    const res = await read(`${pagesBase}/nothing-here.html`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /404/);
});
