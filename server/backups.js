// Automatic backups (scripts/core/auto-backup.js): the pages send a backup every few days and it's
// kept here, the last 10, in <data folder>/backups.
//   POST /api/backups          the backup file (JSON text) -> {name}
//   GET  /api/backups          -> {folder, backups: [{name, size, date}]}, newest first
//   GET  /api/backups/:name    one of them
// Only akko's own pages can reach these (server/guard.js).

const express = require('express');
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');

const router = express.Router();
const DIR = path.join(DATA, 'backups');
const KEEP = 10;
// akko-auto-2026-10-11T09-30-00-123.json: names sort in time order
const NAME = /^akko-auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.json$/;
const nameAt = (ms) => `akko-auto-${new Date(ms).toISOString().slice(0, 23).replace(/[:.]/g, '-')}.json`;

function list() {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((n) => NAME.test(n)); } catch { /* no folder yet */ }
  return names.map((name) => {
    const st = fs.statSync(path.join(DIR, name));
    return { name, size: st.size, date: st.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

// a backup can hold whole books: up to 500 MB, kept as the text it came in
router.post('/', express.raw({ type: () => true, limit: '500mb' }), (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || !/^\s*\{\s*"app"\s*:\s*"akko-immersion"/.test(body.subarray(0, 100).toString('utf8'))) {
    return res.status(400).json({ error: "that isn't an akko backup" });
  }
  fs.mkdirSync(DIR, { recursive: true });
  let at = Date.now();
  while (fs.existsSync(path.join(DIR, nameAt(at)))) at++;
  const name = nameAt(at);
  fs.writeFileSync(path.join(DIR, name) + '.tmp', body);
  fs.renameSync(path.join(DIR, name) + '.tmp', path.join(DIR, name));
  for (const old of list().slice(KEEP)) fs.rmSync(path.join(DIR, old.name), { force: true });
  res.json({ name });
});

router.get('/', (req, res) => res.json({ folder: DIR, backups: list() }));

router.get('/:name', (req, res) => {
  if (!NAME.test(req.params.name) || !fs.existsSync(path.join(DIR, req.params.name))) return res.status(404).json({ error: 'no such backup' });
  res.type('application/json').sendFile(path.join(DIR, req.params.name));
});

module.exports = { router, list, DIR };
