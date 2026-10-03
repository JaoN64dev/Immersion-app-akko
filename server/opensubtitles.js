// English subtitles from OpenSubtitles.com (its REST API, free with your own API key):
//
//   GET  /api/opensubs/status                     -> {configured, user}
//   POST /api/opensubs/settings {apiKey?, username?, password?, clear?}  -> {configured, user}
//   GET  /api/opensubs/search?q=&season=&episode=&lang=en       -> {results: [...]}
//   POST /api/opensubs/download {fileId}          -> {text, name, remaining}
//
// The key (and the login token, never the password) is saved on this computer in
// data/opensubtitles.json, not in the browser, so it doesn't end up in backup files.
// Without an account OpenSubtitles allows about 5 downloads a day; logged in, 20.

const fs = require('fs');
const path = require('path');
const express = require('express');
const { asyncRoute } = require('./http');

const FILE = path.join(__dirname, '..', 'data', 'opensubtitles.json');
const API = 'https://api.opensubtitles.com/api/v1';
// OpenSubtitles asks every app to send its name and version
const APP = 'akko v1.0';

let config = null;     // {apiKey, username, token, baseUrl}

function settings() {
  if (!config) {
    try { config = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { config = {}; }
  }
  return config;
}

function save(next) {
  config = next;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
}

const status = () => ({ configured: !!settings().apiKey, user: settings().token ? settings().username : null });

async function call(method, route, { body, auth = true, query } = {}) {
  const c = settings();
  if (!c.apiKey) throw Object.assign(new Error('add your OpenSubtitles API key in Settings first'), { status: 400 });
  const base = (auth && c.baseUrl) || API;
  const url = `${base}${route}${query ? '?' + new URLSearchParams(query) : ''}`;
  const headers = { 'Api-Key': c.apiKey, 'User-Agent': APP, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && c.token) headers.Authorization = `Bearer ${c.token}`;
  const res = await fetch(url, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.errors?.join(', ') || `${res.status} from OpenSubtitles`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data;
}

// one subtitle result -> what the Watch page lists
function shape(item) {
  const a = item.attributes || {};
  const f = a.feature_details || {};
  return {
    title: f.movie_name || f.title || a.release || '',
    year: f.year || null,
    season: f.season_number || null,
    episode: f.episode_number || null,
    release: a.release || '',
    downloads: a.download_count || 0,
    hearingImpaired: !!a.hearing_impaired,
    machineTranslated: !!(a.machine_translated || a.ai_translated),
    files: (a.files || []).map((x) => ({ id: x.file_id, name: x.file_name || '' })),
  };
}

const router = express.Router();

router.get('/status', (req, res) => res.json(status()));

router.post('/settings', express.json(), asyncRoute(async (req, res) => {
  if (req.body.clear) { save({}); return res.json(status()); }       // forget everything
  // an empty key field keeps the saved key (the page never shows it again)
  const apiKey = String(req.body.apiKey || '').trim() || settings().apiKey || '';
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!apiKey) throw new Error('enter your API key');
  const keepLogin = settings().apiKey === apiKey && settings().username === username && !password;
  save(keepLogin ? { ...settings(), apiKey } : { apiKey, username });
  if (username && password) {
    const login = await call('POST', '/login', { body: { username, password }, auth: false });
    save({ apiKey, username, token: login.token, baseUrl: login.base_url ? `https://${login.base_url}/api/v1` : '' });
  }
  res.json(status());
}));

router.get('/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const query = { query: q, languages: String(req.query.lang || 'en'), order_by: 'download_count' };
  if (req.query.season) query.season_number = String(Number(req.query.season));
  if (req.query.episode) query.episode_number = String(Number(req.query.episode));
  const data = await call('GET', '/subtitles', { query, auth: false });
  res.json({ results: (data.data || []).map(shape).filter((r) => r.files.length).slice(0, 30) });
}));

router.post('/download', express.json(), asyncRoute(async (req, res) => {
  const fileId = Number(req.body.fileId);
  if (!fileId) return res.status(400).json({ error: 'no file' });
  let link;
  try {
    link = await call('POST', '/download', { body: { file_id: fileId, sub_format: 'srt' } });
  } catch (err) {
    // an expired login: forget it and download without it (smaller daily allowance)
    if (err.status !== 401 || !settings().token) throw err;
    save({ apiKey: settings().apiKey, username: settings().username });
    link = await call('POST', '/download', { body: { file_id: fileId, sub_format: 'srt' } });
  }
  const sub = await fetch(link.link, { headers: { 'User-Agent': APP }, signal: AbortSignal.timeout(15000) });
  if (!sub.ok) throw new Error(`${sub.status} downloading the subtitle`);
  res.json({ text: await sub.text(), name: link.file_name || `opensubtitles-${fileId}.srt`, remaining: link.remaining ?? null });
}));

module.exports = { router };
