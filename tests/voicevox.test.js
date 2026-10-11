// VOICEVOX's engine, run by akko (server/voicevox.js): installing it from its release with one
// click (here from a pretend release, not the real 1.9 GB one), and the terms being required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const AdmZip = require('adm-zip');

function fresh(data, env) {
  Object.assign(process.env, { AKKO_DATA: data, ...env });
  for (const m of ['../server/paths', '../server/voicevox']) delete require.cache[require.resolve(m)];
  return require('../server/voicevox');
}

function call(router, method, routePath, body) {
  return new Promise((resolve) => {
    const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
    const handlers = layer.route.stack.map((s) => s.handle);
    const res = { status: (code) => ({ json: (b) => resolve({ code, body: b }) }), json: (b) => resolve({ code: 200, body: b }) };
    // the last handler is the route itself (the first may be express.json(), already "done" here)
    handlers[handlers.length - 1]({ body, query: {} }, res);
  });
}

test('installing VOICEVOX: needs its terms accepted, then downloads, unpacks and remembers it', { skip: process.platform !== 'win32' && 'unpacks with Windows tar' }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-vv-'));
  // a pretend release: one .vvpp (a zip) with the engine's run.exe in it
  const zip = new AdmZip();
  zip.addFile('run.exe', fs.readFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe')));
  zip.addFile('engine_manifest.json', Buffer.from('{"name":"VOICEVOX Engine"}'));
  const vvpp = zip.toBuffer();
  const server = http.createServer((req, res) => {
    if (req.url === '/release') {
      return res.end(JSON.stringify({ tag_name: '9.9.9', assets: [
        { name: 'voicevox_engine-windows-nvidia-9.9.9.vvpp', size: 1, browser_download_url: 'http://nope' },
        { name: 'voicevox_engine-windows-cpu-9.9.9.vvpp', size: vvpp.length, browser_download_url: `http://127.0.0.1:${server.address().port}/engine.vvpp` },
      ] }));
    }
    if (req.url === '/engine.vvpp') return res.end(vvpp);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const vv = fresh(data, { AKKO_VOICEVOX_RELEASES: `http://127.0.0.1:${server.address().port}/release`, AKKO_VOICEVOX_PORT: '59999' });
  try {
    const refused = await call(vv.router, 'post', '/install', {});
    assert.equal(refused.code, 400);
    assert.match(refused.body.error, /terms/);

    const started = await call(vv.router, 'post', '/install', { agree: true });
    assert.equal(started.body.state, 'installing');
    for (let i = 0; i < 100 && vv.status().state === 'installing'; i++) await new Promise((r) => setTimeout(r, 100));

    const engine = path.join(data, 'voicevox', 'engine');
    assert.ok(fs.existsSync(path.join(engine, 'run.exe')), 'the engine was unpacked');
    assert.ok(!fs.existsSync(path.join(data, 'voicevox', 'download.vvpp')), 'the download was removed');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'voicevox', 'akko.json'), 'utf8')), { autostart: true, installed: '9.9.9' });
    assert.equal(vv.findEngine(), path.join(engine, 'run.exe'), 'akko finds its own copy first');
    // the pretend engine isn't a real one, so it doesn't stay up: the page then offers to start it
    assert.notEqual(vv.status().state, 'installing');
    assert.equal(vv.status().found, true);
  } finally {
    vv.stop();
    server.close();
    delete process.env.AKKO_VOICEVOX_RELEASES;
    delete process.env.AKKO_VOICEVOX_PORT;
    for (const m of ['../server/paths', '../server/voicevox']) delete require.cache[require.resolve(m)];
  }
});

test('"start it with akko" is remembered', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-vv-'));
  const vv = fresh(data, { AKKO_VOICEVOX_PORT: '59998' });
  try {
    assert.equal(vv.status().autostart, true, 'on unless turned off');
    await call(vv.router, 'post', '/settings', { autostart: false });
    assert.equal(vv.status().autostart, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'voicevox', 'akko.json'), 'utf8')).autostart, false);
  } finally {
    delete process.env.AKKO_VOICEVOX_PORT;
    for (const m of ['../server/paths', '../server/voicevox']) delete require.cache[require.resolve(m)];
  }
});
