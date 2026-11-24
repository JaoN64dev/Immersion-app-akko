// Watching from a magnet link: the torrent runs here (webtorrent, TCP/UDP + DHT, which is where
// nyaa's peers are; a browser could only reach the few WebRTC ones), only the episode you pick is
// downloaded, in playback order, and the player gets it as a plain video URL with seeking.
//
//   POST   /api/torrent                {magnet}        -> the torrent's video files, once its info arrives
//   GET    /api/torrent                                -> the torrents akko kept (for the list / delete)
//   GET    /api/torrent/:hash                          -> speed, peers, how much of each episode is here
//   GET    /api/torrent/:hash/:index/:name             -> the episode itself (Range requests, for seeking)
//   POST   /api/torrent/:hash/stop                     -> stop sharing it (the files stay)
//   DELETE /api/torrent/:hash                          -> stop and delete its files
//
// Downloaded episodes stay in <data>/torrents, so the features that need the whole file (subtitles
// from audio, the Japanese audio track) can use them afterwards. A torrent shares pieces with
// other people while it runs — that is how BitTorrent works — so the upload is kept low, only one
// torrent runs at a time, and it stops when the episode is closed or nothing has played for a while.

const fs = require('fs');
const path = require('path');
const express = require('express');
const { DATA } = require('./paths');

const DIR = path.join(DATA, 'torrents');
const INDEX = path.join(DIR, 'index.json');
const UPLOAD_LIMIT = 100 * 1024;          // bytes per second shared with others while one plays
const IDLE_MS = 5 * 60e3;                 // nothing streamed or asked for this long: stop sharing
const READY_MS = 90e3;                    // how long to wait for the torrent's info from its peers
const VIDEO = /\.(mkv|mp4|m4v|webm|mov|avi|ts)$/i;
const TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/webm', avi: 'video/x-msvideo', ts: 'video/mp2t' };
// (an .mkv goes out as webm: browsers play Matroska through their WebM reader, but refuse the
//  video/x-matroska type outright)

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const validHash = (h) => /^[a-f0-9]{40}$/.test(String(h || ''));
const isMagnet = (m) => /^magnet:\?/i.test(m) && /xt=urn:btih:[a-z0-9]{32,40}/i.test(m);

// ---------- the torrents akko kept ----------

function readIndex() {
    try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return {}; }
}
function writeIndex(index) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(INDEX, JSON.stringify(index, null, 1));
}

// ---------- the client, made on first use ----------

let clientP = null;
const client = () => (clientP ||= import('webtorrent').then(({ default: WebTorrent }) => {
    // AKKO_OFFLINE (tests, no network): only the peers a magnet names itself (x.pe), no DHT or trackers
    const offline = process.env.AKKO_OFFLINE ? { dht: false, tracker: false, lsd: false, utp: false, natUpnp: false, natPmp: false } : {};
    const c = new WebTorrent({ uploadLimit: UPLOAD_LIMIT, maxConns: 60, ...offline });
    c.on('error', (err) => console.error('torrent:', err.message));
    return c;
}));

let lastUsed = Date.now();
const touch = () => { lastUsed = Date.now(); };

// only one torrent shares at a time: starting one stops the others (their files stay)
async function stopOthers(keep) {
    const c = await client();
    for (const t of [...c.torrents]) if (t.infoHash !== keep) t.destroy({ destroyStore: false });
}

function whenReady(torrent) {
    if (torrent.ready) return Promise.resolve(torrent);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no peers sent the torrent\'s file list in 90 seconds: it may have no seeders')), READY_MS);
        torrent.once('ready', () => { clearTimeout(timer); resolve(torrent); });
        torrent.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
}

// The running torrent for this magnet or hash, added (or resumed from the files already on disk) if needed
async function open(magnetOrHash) {
    const c = await client();
    let hash = validHash(magnetOrHash) ? magnetOrHash : null;
    let magnet = hash ? (readIndex()[hash] || {}).magnet : magnetOrHash;
    if (!magnet) throw Object.assign(new Error('akko doesn\'t know that torrent any more: paste its magnet link again'), { status: 404 });
    let torrent = hash ? await c.get(hash) : null;
    if (!torrent) torrent = await c.get(magnet);
    if (!torrent) {
        fs.mkdirSync(DIR, { recursive: true });
        torrent = c.add(magnet, { path: DIR, deselect: true });
    }
    await whenReady(torrent);
    hash = torrent.infoHash;
    await stopOthers(hash);
    const index = readIndex();
    if (!index[hash]) {
        index[hash] = { magnet, name: torrent.name, added: Date.now() };
        writeIndex(index);
    }
    touch();
    return torrent;
}

const videos = (torrent) => torrent.files
    .map((f, index) => ({ index, name: f.name, path: f.path, length: f.length, progress: Math.round(f.progress * 1000) / 10 }))
    .filter((f) => VIDEO.test(f.name))
    .sort((a, b) => natural(a.path, b.path));

// ---------- routes ----------

const router = express.Router();
const fail = (res, err) => res.status(err.status || 400).json({ error: err.message });

router.post('/', express.json(), async (req, res) => {
    const magnet = String((req.body && req.body.magnet) || '').trim();
    if (!isMagnet(magnet)) return res.status(400).json({ error: 'that isn\'t a magnet link (magnet:?xt=urn:btih:…)' });
    try {
        const t = await open(magnet);
        const files = videos(t);
        if (!files.length) return res.status(400).json({ error: 'there is no video in that torrent' });
        res.json({ hash: t.infoHash, name: t.name, files });
    } catch (err) { fail(res, err); }
});

router.get('/', (req, res) => {
    res.json(Object.entries(readIndex()).map(([hash, t]) => ({ hash, name: t.name, added: t.added }))
        .sort((a, b) => b.added - a.added));
});

router.get('/:hash', async (req, res) => {
    if (!validHash(req.params.hash)) return res.status(400).json({ error: 'bad torrent' });
    const c = await client();
    const t = await c.get(req.params.hash);
    if (!t) return res.json({ running: false });
    touch();
    res.json({
        running: true, ready: t.ready, name: t.name, peers: t.numPeers,
        down: Math.round(t.downloadSpeed), up: Math.round(t.uploadSpeed),
        files: t.ready ? videos(t) : [],
    });
});

router.get('/:hash/:index/:name', async (req, res) => {
    if (!validHash(req.params.hash)) return res.status(400).end();
    let torrent;
    try { torrent = await open(req.params.hash); } catch (err) { return fail(res, err); }
    const file = torrent.files[Number(req.params.index)];
    if (!file || !VIDEO.test(file.name)) return res.status(404).end();
    file.select();
    touch();

    const size = file.length;
    const type = TYPES[path.extname(file.name).slice(1).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = size - 1;
    if (range) {
        if (range[1]) start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
        if (!range[1] && range[2]) { start = Math.max(0, size - Number(range[2])); end = size - 1; }  // the last N bytes
        if (start > end || start >= size) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    }
    res.status(range ? 206 : 200).set({
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') return res.end();
    const stream = file.createReadStream({ start, end });
    stream.on('data', touch);
    stream.on('error', () => res.destroy());
    req.on('close', () => stream.destroy());
    stream.pipe(res);
});

router.post('/:hash/stop', async (req, res) => {
    if (!validHash(req.params.hash)) return res.status(400).end();
    const c = await client();
    const t = await c.get(req.params.hash);
    if (t) t.destroy({ destroyStore: false });
    res.json({ ok: true });
});

router.delete('/:hash', async (req, res) => {
    const hash = req.params.hash;
    if (!validHash(hash)) return res.status(400).end();
    const index = readIndex();
    const entry = index[hash];
    const c = clientP ? await client() : null;
    const t = c && await c.get(hash);
    if (t) await new Promise((r) => t.destroy({ destroyStore: true }, r));
    else if (entry && entry.name) {
        // not running: remove what it downloaded (only ever inside the torrents folder)
        const target = path.resolve(DIR, entry.name);
        if (target.startsWith(path.resolve(DIR) + path.sep)) fs.rmSync(target, { recursive: true, force: true });
    }
    delete index[hash];
    writeIndex(index);
    res.json({ ok: true });
});

// nothing played or asked about for a while (the tab was closed, the computer slept): stop sharing
setInterval(async () => {
    if (!clientP || Date.now() - lastUsed < IDLE_MS) return;
    const c = await client();
    for (const t of [...c.torrents]) t.destroy({ destroyStore: false });
}, 60e3).unref();

// for tests and shutdown: stop every torrent and the client
async function close() {
    if (!clientP) return;
    const c = await clientP;
    clientP = null;
    await new Promise((r) => c.destroy(r));
}

module.exports = { router, isMagnet, validHash, DIR, close };
