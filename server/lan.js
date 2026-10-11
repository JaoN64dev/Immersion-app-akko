// Using akko from a phone or tablet on the same Wi-Fi (Settings → "Use akko on your phone").
// Off by default. When it's on, a second address answers on the home network (port + 1, e.g.
// http://192.168.1.23:3001), and a device must type the PIN shown on the computer once; it then
// gets a sign-in cookie for 30 days. Only devices on the home network (private addresses) are
// answered, five wrong PINs a minute at most, and only the computer itself can change any of this.
//
//   GET  /api/lan           (the computer only) -> {enabled, pin, port, addresses, devices}
//   POST /api/lan           (the computer only) {enabled?, newPin?, forget?}
//   POST /api/lan/login     {pin} -> sign-in cookie
//   GET  /lan-login         the PIN page

const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./paths');

const router = express.Router();
const FILE = path.join(DATA, 'lan.json');
const COOKIE = 'akko_lan';
const DAYS = 30;
const MAX_TRIES = 5;

let server = null;
let lanPort = 0;
let app = null;
const tries = new Map();          // ip -> [times of wrong PINs]

const newPin = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { enabled: false, pin: newPin(), tokens: [] }; }
}
function save(cfg) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));
}

// this computer's addresses on the home network
function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && isPrivate(a.address)) out.push(a.address);
  }
  return out;
}

function isPrivate(ip) {
  const v4 = String(ip).replace(/^::ffff:/, '');
  if (/^(10\.|192\.168\.|169\.254\.|127\.)/.test(v4)) return true;
  const m = v4.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return /^(::1$|fe80:|fc|fd)/i.test(String(ip));        // IPv6 loopback, link-local, unique local
}

function cookieOf(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

function signedIn(req) {
  const token = cookieOf(req);
  if (!token) return false;
  const now = Date.now();
  return read().tokens.some((t) => t.hash === hash(token) && now - t.at < DAYS * 864e5);
}

// Every request that came in through the home-network address goes through this first
// (server/guard.js): devices on the network only, the right Host, and signed in.
function lanGuard(req, res, next) {
  if (!isPrivate(req.socket.remoteAddress)) return res.status(403).send('akko only answers devices on your home network');
  const host = String(req.headers.host || '');
  // an address, not a name (a name could be pointed at this computer by another website)
  if (!/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(host) || !host.endsWith(`:${lanPort}`)) return res.status(403).send('use the address shown in akko’s settings');
  if (req.path === '/lan-login' || req.path === '/api/lan/login' || req.path === '/style.css' || req.path === '/favicon.ico') return next();
  if (signedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'sign in with the PIN first' });
  res.redirect(`/lan-login?to=${encodeURIComponent(req.originalUrl)}`);
}

function listen() {
  if (server || !app) return;
  const cfg = read();
  if (!cfg.enabled) return;
  server = http.createServer((req, res) => { req.viaLan = true; app(req, res); });
  server.on('error', (err) => { console.warn(`phone access: couldn't open port ${lanPort}: ${err.message}`); server = null; });
  server.listen(lanPort, '0.0.0.0', () => console.log(`phone access on: ${addresses().map((a) => `http://${a}:${lanPort}`).join(', ') || `port ${lanPort}`}`));
}

function close() {
  if (server) { server.close(); server.closeAllConnections?.(); server = null; }
}

// server.js: after the main server is up
function start(expressApp, mainPort) {
  app = expressApp;
  lanPort = mainPort + 1;
  listen();
}

const fromComputer = (req, res, next) => (req.viaLan ? res.status(403).json({ error: 'only the computer akko runs on can change this' }) : next());

router.get('/', fromComputer, (req, res) => {
  const cfg = read();
  if (!fs.existsSync(FILE)) save(cfg);         // the PIN stays the same from now on
  res.json({ enabled: !!cfg.enabled, running: !!server, pin: cfg.pin, port: lanPort, addresses: addresses(), devices: cfg.tokens.length });
});

router.post('/', fromComputer, express.json(), (req, res) => {
  const cfg = read();
  const b = req.body || {};
  if (b.newPin) { cfg.pin = newPin(); cfg.tokens = []; }        // a new PIN signs every device out
  if (b.forget) cfg.tokens = [];
  if (typeof b.enabled === 'boolean') cfg.enabled = b.enabled;
  save(cfg);
  if (cfg.enabled) listen(); else close();
  res.json({ enabled: cfg.enabled, running: !!server, pin: cfg.pin, port: lanPort, addresses: addresses(), devices: cfg.tokens.length });
});

router.post('/login', express.json(), (req, res) => {
  const ip = String(req.socket.remoteAddress);
  const now = Date.now();
  const recent = (tries.get(ip) || []).filter((t) => now - t < 60e3);
  if (recent.length >= MAX_TRIES) return res.status(429).json({ error: 'too many tries: wait a minute' });
  const cfg = read();
  const pin = String(req.body?.pin || '');
  const ok = cfg.enabled && pin.length === cfg.pin.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(cfg.pin));
  if (!ok) {
    tries.set(ip, [...recent, now]);
    return res.status(403).json({ error: 'wrong PIN' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  cfg.tokens = [...cfg.tokens.filter((t) => now - t.at < DAYS * 864e5), { hash: hash(token), at: now }].slice(-20);
  save(cfg);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; SameSite=Strict`);
  res.json({ ok: true });
});

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>akko</title><link href="/style.css" rel="stylesheet">
<style>
  body {display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 16px;}
  .lan-box {max-width: 22em; width: 100%; padding: 1.4em; border-radius: 14px; background: var(--post-bg); color: var(--ink); box-shadow: 2px 2px 10px var(--border-shadow);}
  .lan-box h1 {margin: 0 0 .3em; color: var(--dark-link-color);}
  .lan-box input {width: 100%; font-size: 2em; letter-spacing: .3em; text-align: center; padding: .2em; border: 2px solid var(--border-color); border-radius: 10px; background: var(--card); color: var(--ink);}
  .lan-box button {margin-top: .8em; width: 100%; font: inherit; font-weight: bold; font-size: 1.1em; padding: .5em; border-radius: 10px; border: 2px solid var(--border-color); background: var(--extra3); color: #333;}
  .lan-msg {min-height: 1.4em; color: #c62828; margin: .5em 0 0;}
</style></head>
<body><form class="lan-box" id="f">
  <h1>akko</h1>
  <p>Type the PIN shown in akko on your computer (Settings → Use akko on your phone).</p>
  <input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus aria-label="PIN">
  <button>sign in</button>
  <p class="lan-msg" id="msg"></p>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await fetch('/api/lan/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: document.getElementById('pin').value.trim() }) });
    if (r.ok) { const to = new URLSearchParams(location.search).get('to'); location.href = to && to.startsWith('/') && !to.startsWith('//') ? to : '/'; }
    else document.getElementById('msg').textContent = (await r.json().catch(() => ({}))).error || 'that didn\\'t work';
  });
</script></body></html>`;

const loginPage = (req, res) => res.type('html').send(LOGIN_PAGE);

module.exports = { router, start, lanGuard, loginPage, isPrivate, close };
