// Diagnostics and reporting a problem (Settings → Help, the desktop app's Help menu):
//   GET  /api/diagnostics   (the computer only) what akko is running on and how its parts are doing:
//        version, system, memory, the dictionary / VOICEVOX / Anki / extension, the data folder's
//        sizes and the last 100 warnings and errors. Nothing personal: no words, no texts, and the
//        home folder, user name and e-mail addresses are taken out of the messages.
//   POST /api/report {what, expected, steps, error, contact, diagnostics, picture, from} -> {sent: true}
//        or {sent: false, issueUrl}. Goes to akko's report service (AKKO_CLOUD, or "akko.cloud" in
//        package.json: cloud/, the same service as akko accounts), which opens a GitHub issue
//        without the contact address. When there's no service or it can't be reached, issueUrl is a
//        new GitHub issue already filled in, for the person to send (picture not included).
// The page shows exactly what will be sent before sending; nothing is ever sent without asking.

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA } = require('./paths');
const pkg = require('../package.json');

const router = express.Router();
const REPO = 'https://github.com/JaoN64dev/Immersion-app-akko';
const cloudUrl = () => (process.env.AKKO_CLOUD || (pkg.akko && pkg.akko.cloud) || '').replace(/\/+$/, '');

// ---------- the last warnings and errors ----------
const KEEP = 100;
const recent = [];
const home = os.homedir();
let user = '';
try { user = os.userInfo().username; } catch { /* no user info here */ }
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOME = home ? new RegExp(escapeRe(home).replace(/\\\\/g, '[\\\\/]'), 'gi') : null;
const USER = user && user.length > 2 ? new RegExp(`\\b${escapeRe(user)}\\b`, 'gi') : null;

// a message with what could say who you are taken out
function redact(text) {
  let s = String(text);
  if (HOME) s = s.replace(HOME, '~');
  if (USER) s = s.replace(USER, '<user>');
  return s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
}

function keep(level, args) {
  const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
  recent.push({ at: new Date().toISOString(), level, text: redact(text).slice(0, 1000) });
  if (recent.length > KEEP) recent.shift();
}
for (const level of ['warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => { keep(level, args); original(...args); };
}

// ---------- what akko is running on ----------
function sizeOf(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
  } catch { return 0; }
}

async function ankiVersion() {
  try {
    const r = await fetch(process.env.AKKO_ANKI || 'http://127.0.0.1:8765', {
      method: 'POST', body: JSON.stringify({ action: 'version', version: 6 }), signal: AbortSignal.timeout(800),
    });
    return (await r.json()).result || 'connected';
  } catch { return null; }
}

async function diagnostics() {
  const dictionary = require('./dictionary');
  const voicevox = require('./voicevox');
  let extension = null;
  try {
    const seen = JSON.parse(fs.readFileSync(require('./companion').FILE, 'utf8')).seen;
    extension = seen ? { lastSeenMinutesAgo: Math.round((Date.now() - seen) / 60e3) } : null;
  } catch { /* never connected */ }
  let lan = false;
  try { lan = !!JSON.parse(fs.readFileSync(path.join(DATA, 'lan.json'), 'utf8')).enabled; } catch { /* off */ }
  const data = {};
  try { for (const f of fs.readdirSync(DATA)) data[f] = Math.round(sizeOf(path.join(DATA, f)) / 1024); } catch { /* no folder yet */ }
  const d = dictionary.data && dictionary.data();
  const vv = voicevox.status();
  return {
    version: pkg.version,
    app: process.versions.electron ? `desktop app (Electron ${process.versions.electron})` : 'npm start',
    system: `${os.type()} ${os.release()} ${process.arch}`,
    node: process.versions.node,
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    uptimeMinutes: Math.round(process.uptime() / 60),
    dictionary: { ...dictionary.ready, version: (d && d.version) || null },
    voicevox: { state: vv.state, found: vv.found, error: vv.error ? redact(vv.error) : null },
    anki: await ankiVersion(),
    extension,
    phoneAccess: lan,
    cloud: !!cloudUrl(),
    dataKB: data,
    recent: recent.slice(),
  };
}

const fromComputer = (req, res, next) => (req.viaLan ? res.status(403).json({ error: 'only the computer akko runs on can see this' }) : next());

router.get('/diagnostics', fromComputer, async (req, res) => res.json(await diagnostics()));

// ---------- a report ----------
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// the GitHub issue, for when akko's report service can't be used (without the contact address)
function issueUrl(r) {
  const title = text(r.what, 80).split('\n')[0] || 'A problem';
  const parts = [
    `**What happened**\n${r.what}`,
    r.expected ? `**What I expected**\n${r.expected}` : '',
    r.steps ? `**Steps**\n${r.steps}` : '',
    r.error ? `**Error**\n\`\`\`\n${r.error}\n\`\`\`` : '',
    r.from ? `**From**\n${r.from}` : '',
    r.diagnostics ? `**Diagnostics**\n\`\`\`json\n${JSON.stringify(r.diagnostics, null, 1)}\n\`\`\`` : '',
  ].filter(Boolean);
  let body = parts.join('\n\n');
  // addresses longer than ~8000 characters don't open: the diagnostics' oldest messages go first
  const url = () => `${REPO}/issues/new?${new URLSearchParams({ title, body, labels: 'from-app' })}`;
  while (url().length > 7800 && r.diagnostics && r.diagnostics.recent && r.diagnostics.recent.length) {
    r.diagnostics.recent.shift();
    body = [...parts.slice(0, -1), `**Diagnostics**\n\`\`\`json\n${JSON.stringify(r.diagnostics, null, 1)}\n\`\`\``].filter(Boolean).join('\n\n');
  }
  if (url().length > 7800) body = body.slice(0, 5000) + '\n…';
  return url();
}

const sentAt = [];          // at most 5 reports an hour from this computer
router.post('/report', express.json({ limit: '4mb' }), async (req, res) => {
  const b = req.body || {};
  const report = {
    what: text(b.what, 4000),
    expected: text(b.expected, 2000),
    steps: text(b.steps, 3000),
    error: redact(text(b.error, 4000)),
    contact: text(b.contact, 200),
    from: text(b.from, 200),
    diagnostics: b.diagnostics && typeof b.diagnostics === 'object' ? b.diagnostics : null,
    picture: typeof b.picture === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(b.picture) && b.picture.length < 3e6 ? b.picture : null,
  };
  if (!report.what) return res.status(400).json({ error: 'say what happened first' });
  const fallback = () => issueUrl({ ...report });
  const cloud = cloudUrl();
  const now = Date.now();
  while (sentAt.length && now - sentAt[0] > 3600e3) sentAt.shift();
  if (!cloud) return res.json({ sent: false, issueUrl: fallback(), reason: 'no report service yet' });
  if (sentAt.length >= 5) return res.json({ sent: false, issueUrl: fallback(), reason: 'too many reports this hour' });
  try {
    const r = await fetch(`${cloud}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'akko', version: pkg.version, ...report }), signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `the report service answered ${r.status}`);
    sentAt.push(now);
    res.json({ sent: true, issue: j.issue || null });
  } catch (err) {
    res.json({ sent: false, issueUrl: fallback(), reason: err.message });
  }
});

module.exports = { router, diagnostics, redact, issueUrl, cloudUrl };
