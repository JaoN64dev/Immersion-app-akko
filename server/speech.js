// Japanese speech for the listening exercises, made on your computer (offline, free):
//   GET /api/speech/voices    -> {engine: best id | null, engines: [{id, name, voices: {woman, man, narrator}, credit}]}
//   GET /api/speech?text=…&voice=woman|man|narrator[&engine=voicevox|windows]   -> audio/wav
//
// Two engines, the best one that's there is used:
//  - VOICEVOX (or AivisSpeech): free, natural-sounding Japanese voices, used when that program is
//    open on this computer (it answers at 127.0.0.1:50021 / :10101).
//  - Windows' own Japanese voices (Settings → Time & language → Speech: Haruka, Ayumi: women;
//    Ichiro: man), through one PowerShell process in the background (about 0.2 s a line).
// Lines are kept as .wav files in data/speech/, so each is only made once. With neither (macOS,
// Linux without VOICEVOX), the page uses the browser's voices instead.
//
// Why not the browser's voices everywhere: the desktop app's window (Electron) has none.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA } = require('./paths');

const router = express.Router();
const DIR = path.join(DATA, 'speech');
const MAX_TEXT = 400;
const VOICES = ['woman', 'man', 'narrator'];

// The PowerShell side. Requests come in one per line: "<id> <voice> <base64 text> <base64 path>",
// answers go out as "ok <id>" or "err <id> <message>". The first line out lists the voices.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation' + [char]96 + '1' } | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

$ja = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'ja*' })
$women = @($ja | Where-Object { $_.Gender -eq 'Female' })
$men = @($ja | Where-Object { $_.Gender -eq 'Male' })
'voices ' + (($ja | ForEach-Object { $_.DisplayName + '|' + $_.Gender }) -join ';')

$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id = ''
  try {
    $id, $voice, $text64, $out64 = $line.Split(' ')
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text64))
    $out = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($out64))
    $pitch = 1.0
    if ($voice -eq 'man' -and $men.Count) { $v = $men[0] }
    elseif ($voice -eq 'man') { $v = $ja[0]; $pitch = 0.7 }
    elseif ($voice -eq 'narrator' -and $women.Count -gt 1) { $v = $women[1] }
    elseif ($women.Count) { $v = $women[0] }
    else { $v = $ja[0] }
    $s.Voice = $v
    try { $s.Options.AudioPitch = $pitch } catch { }
    $stream = Await ($s.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $n = [uint32]$stream.Size
    $null = Await ($reader.LoadAsync($n)) ([uint32])
    $bytes = New-Object byte[] $n
    $reader.ReadBytes($bytes)
    [IO.File]::WriteAllBytes($out + '.tmp', $bytes)
    Move-Item -Force -LiteralPath ($out + '.tmp') -Destination $out
    'ok ' + $id
  } catch {
    'err ' + $id + ' ' + ($_.Exception.Message -replace '\s+', ' ')
  }
}
`;

let worker = null;          // {proc, ready: Promise<voices>, waiting: Map(id -> {resolve, reject})}
let nextId = 1;

function startWorker() {
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const w = { proc, waiting: new Map() };
  let gotVoices;
  w.ready = new Promise((resolve) => { gotVoices = resolve; });
  let buffered = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffered += chunk;
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (line.startsWith('voices')) {
        gotVoices(line.slice(7).split(';').filter(Boolean).map((v) => {
          const [name, gender] = v.split('|');
          return { name, gender: gender === 'Male' ? 'man' : 'woman' };
        }));
        continue;
      }
      const m = line.match(/^(ok|err) (\d+) ?(.*)$/);
      const job = m && w.waiting.get(m[2]);
      if (!job) continue;
      w.waiting.delete(m[2]);
      if (m[1] === 'ok') job.resolve(); else job.reject(new Error(m[3] || 'Windows could not say it'));
    }
  });
  const fail = () => {
    gotVoices([]);
    for (const job of w.waiting.values()) job.reject(new Error('the speech helper stopped'));
    w.waiting.clear();
    if (worker === w) worker = null;
  };
  proc.on('exit', fail);
  proc.on('error', fail);
  proc.stdin.on('error', () => {});
  return w;
}

// the voices Windows has for Japanese ([] = none, or not Windows)
async function windowsVoices() {
  if (process.platform !== 'win32') return [];
  if (!worker) worker = startWorker();
  return worker.ready;
}

async function windowsSpeak(text, voice, file) {
  const id = String(nextId++);
  const w = worker;
  const done = new Promise((resolve, reject) => w.waiting.set(id, { resolve, reject }));
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  w.proc.stdin.write(`${id} ${voice} ${b64(text)} ${b64(file)}\n`);
  await done;
}

// ---------- VOICEVOX (and engines with the same API, like AivisSpeech) ----------
// Free Japanese voices that sound far more natural than Windows' own. They run on your computer
// once VOICEVOX (voicevox.hiroshiba.jp) or AivisSpeech is open; akko just asks the engine at its
// usual address. Each voice asks to be credited as "VOICEVOX:<name>", which the page shows.

const ENGINE_URLS = (process.env.AKKO_VOICEVOX || 'http://127.0.0.1:50021,http://127.0.0.1:10101').split(',').map((u) => u.trim()).filter(Boolean);

// the voices akko prefers, calm and clear ones first: [speaker name, style]
const PREFER = {
  woman: [['冥鳴ひまり', 'ノーマル'], ['九州そら', 'ノーマル'], ['No.7', 'ノーマル'], ['春日部つむぎ', 'ノーマル'], ['四国めたん', 'ノーマル']],
  man: [['玄野武宏', 'ノーマル'], ['青山龍星', 'ノーマル'], ['雀松朱司', 'ノーマル'], ['白上虎太郎', 'ふつう'], ['剣崎雌雄', 'ノーマル']],
  narrator: [['No.7', 'アナウンス'], ['WhiteCUL', 'ノーマル'], ['もち子さん', 'ノーマル'], ['九州そら', 'ノーマル'], ['四国めたん', 'ノーマル']],
};

let found = { at: 0, engine: null };        // asked again after 10 seconds (2 if it wasn't there)

async function getJsonFrom(url, timeout) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// pick a woman's, a man's and a narrator's voice from the engine's speakers
function pickVoices(speakers) {
  const styles = speakers.flatMap((s) => (s.styles || []).map((st) => ({ id: st.id, speaker: s.name, style: st.name })));
  const used = new Set();
  const picks = {};
  // each role a different speaker (as long as there are enough)
  for (const role of ['woman', 'man', 'narrator']) {
    let pick = null;
    for (const [name, style] of PREFER[role]) {
      const mine = styles.filter((st) => st.speaker === name && !used.has(st.speaker));
      pick = mine.find((st) => st.style === style) || mine[0];
      if (pick) break;
    }
    // none of the usual voices: any other one
    pick ||= styles.find((st) => !used.has(st.speaker)) || styles[0];
    if (!pick) return null;
    picks[role] = { ...pick, pitch: role === 'man' && !PREFER.man.some(([n]) => n === pick.speaker) ? -0.12 : 0 };
    used.add(pick.speaker);
  }
  return picks;
}

// the running engine: {url, name, picks} or null (not open, or nothing found at those addresses)
async function voicevox() {
  if (Date.now() - found.at < (found.engine ? 10000 : 2000)) return found.engine;
  let engine = null;
  for (const url of ENGINE_URLS) {
    try {
      const speakers = await getJsonFrom(url + '/speakers', 800);
      const picks = Array.isArray(speakers) && pickVoices(speakers);
      if (!picks) continue;
      let name = 'VOICEVOX';
      try { name = (await getJsonFrom(url + '/engine_manifest', 800)).name?.replace(/\s*Engine$/i, '') || name; } catch { /* older engines */ }
      engine = { url, name, picks };
      break;
    } catch { /* not running there */ }
  }
  found = { at: Date.now(), engine };
  return engine;
}

async function voicevoxSpeak(engine, text, voice, file) {
  const v = engine.picks[voice] || engine.picks.woman;
  const post = (p, body) => fetch(`${engine.url}${p}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),       // the first line can be slow while the engine loads the voice
  });
  const q = await post(`/audio_query?${new URLSearchParams({ text, speaker: v.id })}`);
  if (!q.ok) throw new Error(`${engine.name} couldn't read the line (${q.status})`);
  const query = await q.json();
  query.pitchScale = (query.pitchScale || 0) + v.pitch;
  query.prePhonemeLength = 0.1;
  query.postPhonemeLength = 0.15;
  const audio = await post(`/synthesis?${new URLSearchParams({ speaker: v.id })}`, query);
  if (!audio.ok) throw new Error(`${engine.name} couldn't say the line (${audio.status})`);
  fs.writeFileSync(file + '.tmp', Buffer.from(await audio.arrayBuffer()));
  fs.renameSync(file + '.tmp', file);
}

// ---------- both ----------

// what can speak on this computer, best first: [{id, name, voices: {woman, man, narrator}, credit}]
async function engines() {
  const list = [];
  const vv = await voicevox();
  if (vv) {
    const label = (p) => `${p.speaker} (${p.style})`;
    list.push({
      id: 'voicevox',
      name: vv.name,
      voices: { woman: label(vv.picks.woman), man: label(vv.picks.man), narrator: label(vv.picks.narrator) },
      credit: [...new Set(Object.values(vv.picks).map((p) => `${vv.name === 'VOICEVOX' ? 'VOICEVOX' : vv.name}:${p.speaker}`))].join(', '),
    });
  }
  const win = await windowsVoices();
  if (win.length) {
    const women = win.filter((v) => v.gender === 'woman');
    const men = win.filter((v) => v.gender === 'man');
    const short = (v) => (v ? v.name.replace(/^Microsoft\s+/, '') : '');
    list.push({
      id: 'windows',
      name: 'Windows',
      voices: { woman: short(women[0] || win[0]), man: short(men[0]) || `${short(win[0])} (lower)`, narrator: short(women[1] || women[0] || win[0]) },
      credit: '',
    });
  }
  return list;
}

// kept for older callers: the Windows voices
const voices = windowsVoices;

const fileFor = (key, text) => path.join(DIR, crypto.createHash('sha1').update(key + '\n' + text).digest('hex') + '.wav');

const making = new Map();       // file -> Promise, so the same line isn't made twice at once

// a .wav of the text in that voice (made once, then kept). engine: "voicevox" | "windows" | "" (the best)
async function speak(text, voice, engine = '') {
  let vv = null;
  if (engine !== 'windows') vv = await voicevox();
  if (engine === 'voicevox' && !vv) throw new Error('VOICEVOX isn\'t running: open it, then try again');
  const useVoicevox = !!vv;
  const key = useVoicevox ? `voicevox:${vv.name}:${(vv.picks[voice] || vv.picks.woman).id}` : voice;
  const file = fileFor(key, text);
  if (fs.existsSync(file)) return file;
  if (making.has(file)) return making.get(file);
  const job = (async () => {
    fs.mkdirSync(DIR, { recursive: true });
    if (useVoicevox) await voicevoxSpeak(vv, text, voice, file);
    else {
      if (!(await windowsVoices()).length) throw new Error('no Japanese voice on this computer');
      await windowsSpeak(text, voice, file);
    }
    return file;
  })();
  making.set(file, job);
  try { return await job; } finally { making.delete(file); }
}

router.get('/voices', async (req, res) => {
  const list = await engines();
  res.json({ engine: list[0]?.id || null, engines: list });
});

router.get('/', async (req, res) => {
  const text = String(req.query.text || '').trim();
  const voice = VOICES.includes(req.query.voice) ? req.query.voice : 'woman';
  const engine = ['voicevox', 'windows'].includes(req.query.engine) ? req.query.engine : '';
  if (!text) return res.status(400).json({ error: 'no text' });
  if (text.length > MAX_TEXT) return res.status(400).json({ error: 'text too long' });
  try {
    const file = await speak(text, voice, engine);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.type('audio/wav').sendFile(file);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// stop the helper with the server (the desktop app quitting, tests)
const stop = () => { if (worker) worker.proc.kill(); };
process.on('exit', stop);

module.exports = { router, voices, engines, speak, stop, pickVoices };
