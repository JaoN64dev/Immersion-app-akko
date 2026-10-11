// 聴解 listening exercises: the file format, the sets that come with akko, the sentence drills,
// and Windows' speech (only where there's a Japanese voice).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const listening = require('../server/listening');

test('a set file: questions, speakers, translations, the right choice', () => {
  const set = listening.parseSet('x', [
    '---', 'title: T', 'level: N4', 'order: 2', 'kind: dialogue', '---',
    '## one',
    'Q: 何を飲みますか。 = What will she drink?',
    '男: コーヒーと紅茶があります。 = There is coffee and tea.',
    '女：紅茶をお願いします。',
    '- コーヒー',
    '- 紅茶 * = tea',
    '> She picks tea.',
  ].join('\n'));
  assert.deepEqual(set.problems, []);
  assert.equal(set.level, 'N4');
  const q = set.questions[0];
  assert.deepEqual(q.question, { text: '何を飲みますか。', en: 'What will she drink?' });
  assert.deepEqual(q.script.map((l) => [l.speaker, l.text, l.en]), [
    ['man', 'コーヒーと紅茶があります。', 'There is coffee and tea.'],
    ['woman', '紅茶をお願いします。', ''],
  ]);
  assert.deepEqual(q.choices, [{ text: 'コーヒー', en: '', correct: false }, { text: '紅茶', en: 'tea', correct: true }]);
  assert.equal(q.explanation, 'She picks tea.');
});

test('mistakes in a set file are reported, and the broken question is left out', () => {
  const set = listening.parseSet('x', [
    '---', 'title: T', 'level: N9', 'kind: dialogue', '---',
    '## no answer marked', 'Q: 何？', '男: はい。', '- a', '- b',
    '## fine', 'Q: 何？', '男: はい。', '- a *', '- b',
    '## no question', '女: はい。', '- a *', '- b',
  ].join('\n'));
  assert.equal(set.questions.length, 1);
  const text = set.problems.join('\n');
  assert.match(text, /level: "N9"/);
  assert.match(text, /no answer marked.*exactly one/);
  assert.match(text, /no question.*Q:/);
});

test('the sets that come with akko: N5 to N1, all valid, with the JLPT kinds of each level', () => {
  const { items: all, problems } = listening.load();
  const items = all.filter((s) => !s.mine);
  assert.deepEqual(problems.filter((p) => !p.file.startsWith('my ')), []);
  for (const level of listening.LEVELS) {
    const here = items.filter((s) => s.level === level);
    for (const kind of ['dialogue', 'response']) assert.ok(here.some((s) => s.kind === kind), `${level}: ${kind}`);
    // 発話表現 (what would you say) is in N5–N3, 概要 (the main point, question at the end) in N3–N1
    assert.equal(here.some((s) => s.kind === 'situation'), ['N5', 'N4', 'N3'].includes(level), `${level}: situation`);
    assert.equal(here.some((s) => s.questionAfter), ['N3', 'N2', 'N1'].includes(level), `${level}: question after`);
  }
  for (const s of items) {
    for (const q of s.questions) {
      assert.ok(q.script.every((l) => l.en), `${s.id}/${q.heading}: every line has a translation`);
      assert.ok(q.explanation, `${s.id}/${q.heading}: has an explanation`);
    }
  }
});

test('audio: a recording, or a part of it', () => {
  assert.deepEqual(listening.parseAudio('talk.mp3'), { audio: { file: 'talk.mp3' } });
  assert.deepEqual(listening.parseAudio('n4 sample.mp3 1:05-1:48'), { audio: { file: 'n4 sample.mp3', start: 65, end: 108 } });
  assert.deepEqual(listening.parseAudio('a.m4a 12.5~20'), { audio: { file: 'a.m4a', start: 12.5, end: 20 } });
  assert.match(listening.parseAudio('notes.txt').problem, /sound file/);
  assert.match(listening.parseAudio('a.mp3 2:00-1:00').problem, /start-end/);
});

test('your own sets: from the data folder, with recordings next to them, served only when a set uses them', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-listening-'));
  process.env.AKKO_DATA = data;
  for (const m of ['../server/paths', '../server/listening']) delete require.cache[require.resolve(m)];
  const mine = require('../server/listening');
  const call = (routePath, req) => new Promise((resolve) => {
    const layer = mine.router.stack.find((l) => l.route && l.route.path === routePath);
    const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }), json: (body) => resolve({ code: 200, body }),
      sendFile: (file) => resolve({ code: 200, file }) };
    layer.route.stack[0].handle({ query: {}, params: {}, ...req }, res);
  });
  // the first visit makes the folder, with the guide and the template
  const list = await call('/', {});
  assert.equal(list.body.myFolder, path.join(data, 'listening'));
  assert.ok(fs.existsSync(path.join(data, 'listening', 'README.md')));
  fs.writeFileSync(path.join(data, 'secret.txt'), 'no');
  fs.writeFileSync(path.join(data, 'listening', 'sample.mp3'), 'ID3 pretend audio');
  fs.writeFileSync(path.join(data, 'listening', 'official.md'), [
    '---', 'title: 公式サンプル', 'level: N4', 'kind: dialogue', '---',
    '## 1番', 'audio: sample.mp3 0:42-2:10', '- 1', '- 2 *', '- 3',
    '## missing file', 'audio: nope.mp3', '- 1 *', '- 2',
  ].join('\n'));
  await new Promise((r) => setTimeout(r, 1100));      // the folder is checked at most once a second
  const { body } = await call('/', {});
  const set = body.sets.find((s) => s.id === 'my-official');
  assert.ok(set && set.mine && set.count === 1, 'the set is listed as yours, without the broken question');
  assert.ok(body.problems.some((p) => p.file === 'my official.md' && /can't find the recording "nope.mp3"/.test(p.problem)));
  const one = await call('/:id', { params: { id: 'my-official' } });
  assert.deepEqual(one.body.questions[0].audio, { file: 'sample.mp3', start: 42, end: 130 });
  assert.equal(one.body.dir, undefined, 'the folder path stays on the server');
  // the recording is served; nothing else in (or outside) the folder is
  assert.equal((await call('/audio', { query: { set: 'my-official', file: 'sample.mp3' } })).file, path.join(data, 'listening', 'sample.mp3'));
  assert.equal((await call('/audio', { query: { set: 'my-official', file: '../secret.txt' } })).code, 404);
  assert.equal((await call('/audio', { query: { set: 'my-official', file: 'official.md' } })).code, 404);
  for (const m of ['../server/paths', '../server/listening']) delete require.cache[require.resolve(m)];
});

test('sentence drills come from the grammar examples of the level, translated when the lesson is', () => {
  const n5 = listening.sentences('N5');
  const n1 = listening.sentences('N1');
  assert.ok(n5.length >= 20 && n1.length >= 20);
  assert.ok(n5.every((s) => s.ja && s.en && s.lesson));
  const pt = listening.sentences('N5', 'pt');
  assert.equal(pt.length, n5.length);
  assert.notDeepEqual(pt.map((s) => s.en), n5.map((s) => s.en));
});

const japaneseVoice = process.platform === 'win32' && require('child_process')
  .spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "Add-Type -AssemblyName System.Runtime.WindowsRuntime; $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]; @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'ja*' }).Count"],
  { encoding: 'utf8', timeout: 30000 }).stdout?.trim() > 0;

test('Windows speaks a line into a .wav, made once and then kept', { skip: !japaneseVoice && 'no Japanese voice on this computer' }, async () => {
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-speech-'));
  delete require.cache[require.resolve('../server/paths')];
  delete require.cache[require.resolve('../server/speech')];
  const speech = require('../server/speech');
  try {
    assert.ok((await speech.voices()).length);
    const file = await speech.speak('駅はどこですか。', 'man');
    const wav = fs.readFileSync(file);
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.ok(wav.length > 10000);
    assert.ok(file.startsWith(process.env.AKKO_DATA));
    const started = Date.now();
    assert.equal(await speech.speak('駅はどこですか。', 'man'), file);
    assert.ok(Date.now() - started < 50, 'the second time comes from the file');
  } finally {
    speech.stop();
  }
});

test('VOICEVOX: calm voices picked, a different speaker for each role', () => {
  const { pickVoices } = require('../server/speech');
  const speakers = [
    { name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }] },
    { name: '冥鳴ひまり', styles: [{ name: 'ノーマル', id: 14 }] },
    { name: '玄野武宏', styles: [{ name: 'ノーマル', id: 11 }, { name: '喜び', id: 39 }] },
    { name: 'No.7', styles: [{ name: 'ノーマル', id: 29 }, { name: 'アナウンス', id: 30 }] },
  ];
  const p = pickVoices(speakers);
  assert.deepEqual([p.woman.id, p.man.id, p.narrator.id], [14, 11, 30]);
  assert.equal(p.man.pitch, 0);
  // an engine with only unknown voices still works: different speakers, the "man" a bit lower
  const odd = pickVoices([{ name: 'A', styles: [{ name: 'x', id: 1 }] }, { name: 'B', styles: [{ name: 'y', id: 2 }] }]);
  assert.deepEqual([odd.woman.id, odd.man.id], [1, 2]);
  assert.ok(odd.man.pitch < 0);
  assert.equal(pickVoices([]), null);
});

test('VOICEVOX is used when it is running, and credited', async () => {
  const http = require('http');
  const asked = [];
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(20000)]);
  const engine = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    asked.push(`${req.method} ${url.pathname} ${url.searchParams.get('speaker') || ''}`);
    if (url.pathname === '/speakers') return res.end(JSON.stringify([
      { name: '冥鳴ひまり', styles: [{ name: 'ノーマル', id: 14 }] },
      { name: '青山龍星', styles: [{ name: 'ノーマル', id: 13 }] },
      { name: 'No.7', styles: [{ name: 'アナウンス', id: 30 }] },
    ]));
    if (url.pathname === '/engine_manifest') return res.end(JSON.stringify({ name: 'VOICEVOX Engine' }));
    if (url.pathname === '/audio_query') return res.end(JSON.stringify({ pitchScale: 0, speedScale: 1 }));
    if (url.pathname === '/synthesis') {
      let body = '';
      req.on('data', (c) => { body += c; });
      return req.on('end', () => { asked.push('query ' + body); res.setHeader('Content-Type', 'audio/wav'); res.end(wav); });
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => engine.listen(0, '127.0.0.1', r));
  process.env.AKKO_VOICEVOX = `http://127.0.0.1:${engine.address().port}`;
  process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-voicevox-'));
  for (const m of ['../server/paths', '../server/speech']) delete require.cache[require.resolve(m)];
  const speech = require('../server/speech');
  try {
    const [best] = await speech.engines();
    assert.equal(best.id, 'voicevox');
    assert.equal(best.name, 'VOICEVOX');
    assert.equal(best.voices.man, '青山龍星 (ノーマル)');
    assert.equal(best.credit, 'VOICEVOX:冥鳴ひまり, VOICEVOX:青山龍星, VOICEVOX:No.7');
    const file = await speech.speak('駅はどこですか。', 'man');
    assert.deepEqual(fs.readFileSync(file), wav);
    assert.ok(asked.includes('POST /audio_query 13') && asked.includes('POST /synthesis 13'), asked.join('\n'));
    assert.match(asked.find((a) => a.startsWith('query ')), /"postPhonemeLength":0.15/);
    // made once: the second time doesn't ask the engine
    const before = asked.length;
    assert.equal(await speech.speak('駅はどこですか。', 'man'), file);
    assert.equal(asked.filter((a) => a.includes('synthesis')).length, asked.slice(0, before).filter((a) => a.includes('synthesis')).length);
  } finally {
    speech.stop();
    engine.close();
    delete process.env.AKKO_VOICEVOX;
    for (const m of ['../server/paths', '../server/speech']) delete require.cache[require.resolve(m)];
  }
});
