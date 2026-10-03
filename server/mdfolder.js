// Folders of Markdown files with a settings block at the top (grammar/, course/).
// The folder is re-read when a file is added, removed or changed (checked at most once a
// second), so edits show up on the next page load without restarting the server.

const fs = require('fs');
const path = require('path');

// "---\na: 1\nb: 2\nb: 3\n---\nbody" -> {meta: {a: ["1"], b: ["2", "3"]}, body, problems}
// Lines starting with # inside the settings are comments.
function splitFrontMatter(source) {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      (meta[m[1].toLowerCase()] ||= []).push(m[2]);
    }
  }
  return {
    meta,
    body: fm ? text.slice(fm[0].length) : text,
    problems: fm ? [] : ['no settings block (--- at the top and bottom)'],
  };
}

// the last value of a setting ("" if it isn't there)
const one = (meta, key) => (meta[key] ? meta[key][meta[key].length - 1] : '');

// Files in dir that are items: .md, not README.md, not starting with _
function listFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /\.md$/i.test(f) && !f.startsWith('_') && !/^readme\.md$/i.test(f));
  } catch {
    return [];         // no folder: no items
  }
}

// build([{file, id, text}]) -> {items, problems: [{file, problem}]}; returns load() -> that, cached
function folder(dir, name, build) {
  let cache = { signature: null, items: [], problems: [] };
  let lastCheck = 0;
  return function load() {
    if (Date.now() - lastCheck < 1000) return cache;
    lastCheck = Date.now();
    const files = listFiles(dir);
    const times = files.map((f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } });
    const signature = files.map((f, i) => f + times[i]).join('|');
    if (signature === cache.signature) return cache;

    const read = [];
    const problems = [];
    for (const file of files) {
      try {
        read.push({ file, id: file.replace(/\.md$/i, ''), text: fs.readFileSync(path.join(dir, file), 'utf8') });
      } catch (err) {
        problems.push({ file, problem: err.message });
      }
    }
    const built = build(read);
    problems.push(...built.problems);
    problems.forEach((p) => console.warn(`${name}: ${p.file}: ${p.problem}`));
    if (cache.signature !== null || built.items.length) console.log(`${name}: ${built.items.length} ready`);
    cache = { signature, items: built.items, problems };
    return cache;
  };
}

module.exports = { splitFrontMatter, one, folder };
