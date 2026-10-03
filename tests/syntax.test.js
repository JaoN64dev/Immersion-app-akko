// Every script parses. The page scripts only run in the browser, so a typo in one would
// otherwise only show up as a broken page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function scriptsIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return scriptsIn(p);
    return /\.(js|mjs)$/.test(d.name) ? [p] : [];
  });
}

test('every browser, server and desktop-app script parses', () => {
  const files = ['scripts', 'server', 'electron', 'tools'].flatMap((d) => scriptsIn(path.join(ROOT, d))).concat(path.join(ROOT, 'server.js'));
  assert.ok(files.length > 50);
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`${path.relative(ROOT, file)}: ${String(err.stderr).trim().split('\n').slice(0, 5).join('\n')}`);
    }
  }
});
