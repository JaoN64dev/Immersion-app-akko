// 聴解 Listening exercises (Japanese only), from listening/*.md (the ones that come with akko) and
// <data folder>/listening/*.md (your own), plus sentence drills made from the grammar examples:
//   GET /api/listening                       -> {sets: [{id, title, level, order, kind, count, mine}], problems, myFolder}
//   GET /api/listening/sentences?level=N5[&native=pt]   -> {sentences: [{ja, en, lesson, title}]}
//   GET /api/listening/audio?set=<id>&file=<name>       -> an audio file next to that set's .md
//   GET /api/listening/:id                   -> one set, with its questions
//
// A set is one file; each "## heading" in it is one question. listening/README.md explains the
// format. A question is said by the computer's voices, or plays a recording ("audio: file.mp3",
// optionally only part of it: "audio: file.mp3 1:05-1:48"). Recordings live next to the set's
// file. Your own sets go in the data folder because the app's own folder can't be written to
// once akko is installed. Both folders are re-read when a file changes.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { splitFrontMatter, one, folder } = require('./mdfolder');
const grammar = require('./grammar');
const { DATA } = require('./paths');

const router = express.Router();
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
// dialogue: question + conversation; response: one line, spoken replies; situation: a situation
// is described, then what you could say is spoken (the JLPT's 発話表現)
const KINDS = ['dialogue', 'response', 'situation'];
const SPEAKERS = { 男: 'man', 女: 'woman', M: 'man', F: 'woman' };
const BUILT_IN = path.join(__dirname, '..', 'listening');
const MINE = path.join(DATA, 'listening');
const MY_PREFIX = 'my-';
const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|webm|flac)$/i;

// "text = translation" -> {text, en}
function withTranslation(s) {
  const at = s.indexOf(' = ');
  return at < 0 ? { text: s.trim(), en: '' } : { text: s.slice(0, at).trim(), en: s.slice(at + 3).trim() };
}

// "1:05" / "65" / "65.5" -> seconds (NaN if it isn't a time)
function seconds(s) {
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

// "file.mp3" / "file.mp3 1:05-1:48" -> {file, start, end} or {problem}
function parseAudio(value) {
  const m = value.match(/^(.+?\.[a-z0-9]+)(?:\s+([\d:.]+)\s*[-~〜]\s*([\d:.]+))?$/i);
  if (!m || !AUDIO.test(m[1])) return { problem: `audio: "${value}" should be a sound file (.mp3, .m4a, .ogg, .wav…), optionally with a part like 1:05-1:48` };
  const audio = { file: m[1].trim() };
  if (m[2]) {
    audio.start = seconds(m[2]);
    audio.end = seconds(m[3]);
    if (!(audio.end > audio.start)) return { problem: `audio: "${m[2]}-${m[3]}" should be start-end, like 1:05-1:48` };
  }
  return { audio };
}

function parseQuestion(heading, lines, kind) {
  const q = { heading, question: null, audio: null, script: [], choices: [], explanation: [] };
  const problems = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^Q\s*[:：]\s*(.+)$/))) q.question = withTranslation(m[1]);
    else if ((m = line.match(/^audio\s*[:：]\s*(.+)$/i))) {
      const a = parseAudio(m[1].trim());
      if (a.problem) problems.push(`"${heading}": ${a.problem}`); else q.audio = a.audio;
    } else if ((m = line.match(/^(男|女|M|F)\s*[:：]\s*(.+)$/))) q.script.push({ speaker: SPEAKERS[m[1]], ...withTranslation(m[2]) });
    else if ((m = line.match(/^[-*]\s+(.+)$/))) {
      const c = withTranslation(m[1]);
      const correct = /(^|\s)\*$/.test(c.text);
      q.choices.push({ ...c, text: c.text.replace(/\s*\*$/, ''), correct });
    } else if ((m = line.match(/^>\s?(.*)$/))) q.explanation.push(m[1]);
    else problems.push(`"${heading}": can't read "${line}"`);
  }
  q.explanation = q.explanation.join(' ').trim();
  const correct = q.choices.filter((c) => c.correct).length;
  // with a recording, the lines and the question are in it: writing them down is optional
  if (!q.script.length && !q.audio && kind !== 'situation') problems.push(`"${heading}": nothing to listen to (男: … / 女: … lines, or audio: file.mp3)`);
  if ((kind === 'dialogue' || kind === 'situation') && !q.question && !q.audio) problems.push(`"${heading}": no question (Q: …)`);
  if (q.choices.length < 2 || q.choices.length > 4) problems.push(`"${heading}": needs 2 to 4 choices (- …)`);
  if (q.choices.some((c) => !c.text)) problems.push(`"${heading}": a choice has no text (write at least its number: - 1)`);
  if (correct !== 1) problems.push(`"${heading}": mark exactly one choice as right (put * at its end)`);
  return { q, problems };
}

// dir: where the file is (recordings are looked for next to it)
function parseSet(id, source, dir = BUILT_IN) {
  const { meta, body, problems } = splitFrontMatter(source);
  const kind = one(meta, 'kind') || 'dialogue';
  if (!KINDS.includes(kind)) problems.push(`kind: "${kind}" should be ${KINDS.join(' or ')}`);
  const level = one(meta, 'level');
  if (!LEVELS.includes(level)) problems.push(`level: "${level}" should be one of ${LEVELS.join(', ')}`);
  const title = one(meta, 'title');
  if (!title) problems.push('no title');

  const questions = [];
  let heading = null;
  let lines = [];
  const flush = () => {
    if (heading === null) return;
    const { q, problems: p } = parseQuestion(heading, lines, kind);
    if (q.audio && !p.length && !fileIn(dir, q.audio.file)) p.push(`"${heading}": can't find the recording "${q.audio.file}" next to this file`);
    problems.push(...p);
    if (!p.length) questions.push(q);
  };
  for (const line of body.split('\n')) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { flush(); heading = h[1].trim(); lines = []; } else if (heading !== null) lines.push(line);
  }
  flush();
  if (!questions.length) problems.push('no questions (each one starts with ## and a name)');
  // question: after = the question is only asked at the end (the JLPT's 概要理解: listen for the main point)
  const questionAfter = /^after$/i.test(one(meta, 'question'));
  return { id, title: title || id, level, order: Number(one(meta, 'order')) || 0, kind, questionAfter, questions, problems };
}

// the path of a file inside dir (no "../" out of it), or null if there's no such file
function fileIn(dir, name) {
  const full = path.resolve(dir, name);
  if (!full.startsWith(path.resolve(dir) + path.sep)) return null;
  try { return fs.statSync(full).isFile() ? full : null; } catch { return null; }
}

const rank = (l) => (LEVELS.includes(l) ? LEVELS.indexOf(l) : LEVELS.length);

const loaderFor = (dir, name, prefix) => folder(dir, name, (files) => {
  const sets = [];
  const problems = [];
  for (const { file, id, text } of files) {
    const set = parseSet(prefix + id, text, dir);
    set.problems.forEach((p) => problems.push({ file: (prefix ? 'my ' : '') + file, problem: p }));
    if (set.questions.length) sets.push({ ...set, mine: !!prefix, dir });
  }
  return { items: sets, problems };
});
const loadBuiltIn = loaderFor(BUILT_IN, 'listening', '');
const loadMine = loaderFor(MINE, 'my listening', MY_PREFIX);

// every set, akko's first then yours, by level and order
function load() {
  const a = loadBuiltIn();
  const b = loadMine();
  const items = [...a.items, ...b.items].sort((x, y) => rank(x.level) - rank(y.level) || x.mine - y.mine
    || x.order - y.order || x.title.localeCompare(y.title, 'ja'));
  return { items, problems: [...a.problems, ...b.problems] };
}

// the grammar examples of one level, in your language when the lesson is translated
function sentences(level, native = '') {
  const out = [];
  for (const l of grammar.lessons('ja', native).items) {
    if (l.level !== level) continue;
    for (const e of l.examples) if (e.ja && e.en) out.push({ ja: e.ja, en: e.en, lesson: l.id, title: l.title });
  }
  return out;
}

// your folder, made the first time with the guide and the template in it, so it's easy to start
function makeMyFolder() {
  try {
    fs.mkdirSync(MINE, { recursive: true });
    for (const name of ['README.md', '_template.md']) {
      const to = path.join(MINE, name);
      if (!fs.existsSync(to)) fs.copyFileSync(path.join(BUILT_IN, name), to);
    }
  } catch { /* read-only data folder: the page still works */ }
}

router.get('/', (req, res) => {
  makeMyFolder();
  const { items, problems } = load();
  res.json({
    sets: items.map(({ id, title, level, order, kind, questions, mine }) => ({ id, title, level, order, kind, count: questions.length, mine })),
    levels: LEVELS,
    problems,
    myFolder: MINE,
  });
});

router.get('/sentences', (req, res) => {
  const level = String(req.query.level || '');
  if (!LEVELS.includes(level)) return res.status(400).json({ error: `level should be one of ${LEVELS.join(', ')}` });
  res.json({ sentences: sentences(level, String(req.query.native || '')) });
});

// a recording, only from the folder of a set that uses it (sendFile also answers range requests,
// so the page can jump to the part a question uses)
router.get('/audio', (req, res) => {
  const set = load().items.find((s) => s.id === req.query.set);
  const name = String(req.query.file || '');
  if (!set || !set.questions.some((q) => q.audio && q.audio.file === name)) return res.status(404).json({ error: 'no such recording' });
  const file = fileIn(set.dir, name);
  if (!file) return res.status(404).json({ error: 'no such recording' });
  res.sendFile(file);
});

router.get('/:id', (req, res) => {
  const set = load().items.find((s) => s.id === req.params.id);
  if (!set) return res.status(404).json({ error: `no listening set called ${req.params.id}` });
  const { problems: _, dir: __, ...rest } = set;
  res.json(rest);
});

module.exports = { router, load, sentences, parseSet, parseAudio, LEVELS, MINE };
