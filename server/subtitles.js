// Japanese subtitles from kitsunekko.net, its GitHub mirror (Ajatt-Tools/kitsunekko-mirror),
// and Matchoo95/JP-Subtitles on GitHub (live-action films, dramas, Netflix shows)
//
//   GET /api/subs/shows?source=            every show folder
//   GET /api/subs/files?source=&dir=       files + sub-folders in one folder
//   GET /api/subs/file?source=&path=       a subtitle as text (zips: entry list, or ?entry=)

const path = require('path');
const express = require('express');
const AdmZip = require('adm-zip');
const iconv = require('iconv-lite');
const { UA, cached, fetchText, fetchBuffer, asyncRoute } = require('./http');

const SUB_EXTS = ['srt', 'ass', 'ssa', 'vtt'];
const extOf = (name) => (name.split('.').pop() || '').toLowerCase();

// Subtitle files come in UTF-8, UTF-16 or Shift-JIS; figure out which
function decodeSubtitle(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  if (buf[0] === 0xFF && buf[1] === 0xFE) return iconv.decode(buf.slice(2), 'utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) return iconv.decode(buf.slice(2), 'utf16be');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return iconv.decode(buf, 'shift_jis');
  }
}

// ---------- kitsunekko.net (scraped directory listings) ----------

const KITSUNEKKO = 'https://kitsunekko.net';
const SUB_ROOT = 'subtitles/japanese/';

const decodeHtml = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

// Only allow paths inside kitsunekko's japanese subtitle folder
function safeSubPath(p) {
  if (typeof p !== 'string' || !p.startsWith(SUB_ROOT) || p.includes('..')) return null;
  return p;
}

// Parse a kitsunekko dirlist page into folders + files
function parseListing(html) {
  const folders = [];
  const files = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const link = row.match(/<a href="([^"]+)"[^>]*><strong>([\s\S]*?)<\/strong>/);
    if (!link) continue;
    const href = decodeHtml(link[1]);
    const name = decodeHtml(link[2]).trim();
    const date = (row.match(/class="tdright" title="([^"]+)"/) || [])[1] || '';
    if (href.startsWith('/dirlist.php?dir=')) {
      const dir = decodeURIComponent(href.slice('/dirlist.php?dir='.length).replace(/\+/g, ' '));
      folders.push({ name, dir, date });
    } else if (href.startsWith(SUB_ROOT)) {
      const size = Number((row.match(/class="tdleft"\s+title="(\d+)"/) || [])[1] || 0);
      files.push({ name, path: href, size, date, ext: extOf(href) });
    }
  }
  return { folders, files };
}

async function listDir(dir) {
  const url = `${KITSUNEKKO}/dirlist.php?dir=${encodeURIComponent(dir)}`;
  return parseListing(await fetchText(url));
}

// ---------- GitHub repos ----------
// Folders are listed with the git trees API (one call per folder, cached; GitHub allows
// 60 calls/hour without a token, set GITHUB_TOKEN for more). Files come from
// raw.githubusercontent.com, which isn't rate limited.

const MIRROR = 'Ajatt-Tools/kitsunekko-mirror';
const MIRROR_CATEGORIES = { anime_tv: '', anime_movie: ' (movie)' };
const JPSUBS = 'Matchoo95/JP-Subtitles';

function githubHeaders() {
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function githubJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit hit, try again in a bit (or set GITHUB_TOKEN)');
  if (!res.ok) throw new Error(`${res.status} from GitHub`);
  return res.json();
}

// tree shas never change, so these can be cached forever
const githubTree = (repo, sha) => cached(`tree:${repo}:${sha}`, Infinity, async () =>
  (await githubJson(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(sha)}`)).tree);

// sha of the folder the subtitles live in, at the current commit (re-checked every 6 hours)
const mirrorRoot = () => cached('root:' + MIRROR, 6 * 3600e3, async () =>
  (await githubTree(MIRROR, 'main')).find((t) => t.path === 'subtitles').sha);
const jpsubsRoot = () => cached('root:' + JPSUBS, 6 * 3600e3, async () =>
  (await githubJson(`https://api.github.com/repos/${JPSUBS}/commits/master`)).commit.tree.sha);

// Walk "Show Name/sub folder" down from a root tree to its sha
async function treeSha(repo, root, dir) {
  let sha = root;
  for (const part of dir.split('/')) {
    const node = (await githubTree(repo, sha)).find((t) => t.path === part && t.type === 'tree');
    if (!node) throw new Error('folder not found on GitHub');
    sha = node.sha;
  }
  return sha;
}

// Folders + files of one tree, as the browser wants them
async function treeListing(repo, sha, dir) {
  const visible = (await githubTree(repo, sha)).filter((t) => !t.path.startsWith('.'));
  return {
    folders: visible.filter((t) => t.type === 'tree').map((t) => ({ name: t.path, dir: `${dir}/${t.path}` })),
    files: visible.filter((t) => t.type === 'blob')
      .map((t) => ({ name: t.path, path: `${dir}/${t.path}`, size: t.size, ext: extOf(t.path) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  };
}

const cleanParts = (p) => typeof p === 'string' && p !== '' && p.split('/').every((s) => s && s !== '.' && s !== '..');
const safeMirrorPath = (p) => (cleanParts(p) && p.split('/')[0] in MIRROR_CATEGORIES ? p : null);
const safeRepoPath = (p) => (cleanParts(p) ? p : null);
const rawUrl = (repo, branch, p) => `https://raw.githubusercontent.com/${repo}/${branch}/${p.split('/').map(encodeURIComponent).join('/')}`;

// ---------- sources: same interface for all ----------

const sources = {
  kitsunekko: {
    safe: safeSubPath,
    shows: async () => (await listDir(SUB_ROOT)).folders,
    files: listDir,
    url: (p) => `${KITSUNEKKO}/${encodeURI(p)}`,
  },
  github: {
    safe: safeMirrorPath,
    async shows() {
      const root = await githubTree(MIRROR, await mirrorRoot());
      const lists = await Promise.all(Object.entries(MIRROR_CATEGORIES).map(async ([cat, suffix]) => {
        const node = root.find((t) => t.path === cat);
        return (await githubTree(MIRROR, node.sha))
          .filter((t) => t.type === 'tree')
          .map((t) => ({ name: t.path + suffix, dir: `${cat}/${t.path}` }));
      }));
      return lists.flat();
    },
    files: async (dir) => treeListing(MIRROR, await treeSha(MIRROR, await mirrorRoot(), dir), dir),
    url: (p) => rawUrl(MIRROR, 'main', 'subtitles/' + p),
  },
  // live-action films, dramas and shows, one folder per title
  jpsubs: {
    safe: safeRepoPath,
    shows: async () => (await githubTree(JPSUBS, await jpsubsRoot()))
      .filter((t) => t.type === 'tree' && !t.path.startsWith('.'))
      .map((t) => ({ name: t.path, dir: t.path })),
    files: async (dir) => treeListing(JPSUBS, await treeSha(JPSUBS, await jpsubsRoot(), dir), dir),
    url: (p) => rawUrl(JPSUBS, 'master', p),
  },
};

function pickSource(req, res) {
  const src = sources[req.query.source || 'kitsunekko'];
  if (!src) res.status(400).json({ error: 'unknown source' });
  return src;
}

// ---------- routes ----------

const router = express.Router();

// Every show folder in a source, cached for 6 hours
router.get('/shows', asyncRoute(async (req, res) => {
  const src = pickSource(req, res);
  if (!src) return;
  res.json(await cached('shows:' + req.query.source, 6 * 3600e3, src.shows));
}));

// Files (and sub-folders) inside one show folder
router.get('/files', asyncRoute(async (req, res) => {
  const src = pickSource(req, res);
  if (!src) return;
  const dir = src.safe(req.query.dir);
  if (!dir) return res.status(400).json({ error: 'bad dir' });
  res.json(await cached(`dir:${req.query.source}:${dir}`, 30 * 60e3, () => src.files(dir)));
}));

// A subtitle file as text. Zips return their entry list unless ?entry= is given.
router.get('/file', asyncRoute(async (req, res) => {
  const src = pickSource(req, res);
  if (!src) return;
  const p = src.safe(req.query.path);
  if (!p) return res.status(400).json({ error: 'bad path' });
  const ext = extOf(p);
  const buf = await cached(`file:${req.query.source}:${p}`, 30 * 60e3, () => fetchBuffer(src.url(p)));

  if (ext === 'zip') {
    const zip = new AdmZip(buf);
    const entries = zip.getEntries()
      .filter((e) => !e.isDirectory && SUB_EXTS.includes(extOf(e.entryName)))
      .map((e) => e.entryName)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!req.query.entry) return res.json({ entries });
    const entry = zip.getEntry(req.query.entry);
    if (!entry) return res.status(404).json({ error: 'entry not found' });
    return res.json({ name: entry.entryName, ext: extOf(entry.entryName), text: decodeSubtitle(entry.getData()) });
  }

  if (!SUB_EXTS.includes(ext)) return res.status(415).json({ error: `.${ext} files are not supported` });
  res.json({ name: path.basename(p), ext, text: decodeSubtitle(buf) });
}));

module.exports = { router };
