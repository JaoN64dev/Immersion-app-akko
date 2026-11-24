// Watching from a magnet link (server/torrent.js), end to end and offline: a second client on this
// computer seeds the sample video, the magnet points at it directly (x.pe), and the route has to
// list the video, stream exact byte ranges for seeking, and stop / delete when asked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-torrent-test-'));

const express = require('express');
const torrent = require('../server/torrent.js');
const { default: WebTorrent } = await import('webtorrent');

const SAMPLE = path.join(import.meta.dirname, '..', 'samples', 'wagahai.webm');
const bytes = fs.readFileSync(SAMPLE);
let seeder, seed, server, base, magnet;

before(async () => {
    seeder = new WebTorrent({ dht: false, tracker: false, lsd: false, utp: false });
    seed = await new Promise((resolve) => seeder.seed(SAMPLE, { announce: [] }, resolve));
    await new Promise((r) => (seeder.address() ? r() : seeder.once('listening', r)));
    magnet = `${seed.magnetURI}&x.pe=127.0.0.1:${seeder.address().port}`;
    const app = express();
    app.use('/api/torrent', torrent.router);
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}/api/torrent`;
});

after(async () => {
    await torrent.close();
    await new Promise((r) => seeder.destroy(r));
    server.close();
    fs.rmSync(process.env.AKKO_DATA, { recursive: true, force: true });
});

test('only magnet links, and only real info-hashes in the paths', async () => {
    assert.equal(torrent.isMagnet('magnet:?xt=urn:btih:' + 'a'.repeat(40)), true);
    assert.equal(torrent.isMagnet('https://nyaa.si/view/1'), false);
    assert.equal(torrent.validHash('../../etc'), false);
    let r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ magnet: 'http://example.com/a.torrent' }) });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/not-a-hash/0/x.mkv`);
    assert.equal(r.status, 400);
});

test('a magnet link gives its video files, and the episode streams with exact byte ranges', { timeout: 120e3 }, async () => {
    const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ magnet }) });
    const body = await r.json();
    assert.equal(r.status, 200, body.error);
    assert.equal(body.hash, seed.infoHash);
    assert.deepEqual(body.files.map((f) => f.name), ['wagahai.webm']);

    const link = `${base}/${body.hash}/${body.files[0].index}/${encodeURIComponent(body.files[0].name)}`;
    const part = await fetch(link, { headers: { Range: 'bytes=1000-1999' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 1000-1999/${bytes.length}`);
    assert.equal(part.headers.get('content-type'), 'video/webm');
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(1000, 2000));

    const tail = await fetch(link, { headers: { Range: 'bytes=-500' } });
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(bytes.length - 500), 'the last 500 bytes (players ask for the end first)');

    const whole = await fetch(link);
    assert.equal(whole.status, 200);
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes);

    const status = await (await fetch(`${base}/${body.hash}`)).json();
    assert.equal(status.running, true);
    assert.equal(status.files[0].progress, 100);
    assert.equal((await (await fetch(base)).json())[0].hash, body.hash, 'kept in the list');
});

test('stop keeps the file; delete removes it and forgets the torrent', { timeout: 60e3 }, async () => {
    const file = path.join(torrent.DIR, 'wagahai.webm');
    assert.ok(fs.existsSync(file), 'downloaded into <data>/torrents');
    await fetch(`${base}/${seed.infoHash}/stop`, { method: 'POST' });
    assert.equal((await (await fetch(`${base}/${seed.infoHash}`)).json()).running, false);
    assert.ok(fs.existsSync(file), 'stopping keeps what was downloaded');

    const r = await fetch(`${base}/${seed.infoHash}`, { method: 'DELETE' });
    assert.equal(r.status, 200);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(await (await fetch(base)).json(), []);
});
