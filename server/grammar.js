// Grammar lessons: one Markdown file per lesson in ./grammar (Japanese) and ./grammar-en
// (English); see grammar/README.md
//
//   GET /api/grammar[?lang=en]        -> {lessons: [{id, title, meaning, level, order, see}], problems}
//   GET /api/grammar/<id>[?lang=en]   -> one whole lesson (explanation, examples, quiz, rules)
//   The list stays small however many lessons there are; a lesson's text comes when it's opened.
//
// Edits show up on the next page load without restarting the server (server/mdfolder.js).
// Each lesson can have `detect:` rules; the tokenizer (server/dictionary.js) uses them to mark
// that grammar in subtitles and texts.

const path = require('path');
const express = require('express');
const { splitFrontMatter, one, folder } = require('./mdfolder');

const DIRS = { ja: 'grammar', en: 'grammar-en' };
// sorted first, in this order; other levels after
const LEVELS = { ja: ['N5', 'N4', 'N3', 'N2', 'N1'], en: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] };

// Part-of-speech names for [brackets] in Japanese detect rules. Kuromoji's own names (動詞, 接続助詞…)
// work too. English rules use the tags from server/english.js as they are ([ing], [pp], [modal]…).
const POS = {
  verb: '動詞', noun: '名詞', adjective: '形容詞', adj: '形容詞', adverb: '副詞',
  particle: '助詞', aux: '助動詞', auxiliary: '助動詞', suffix: '接尾', conjunction: '接続詞',
};

// ---------- reading the files ----------

// "- 日本語 = English" -> {ja, en}
function parseExample(line) {
  const [ja, ...rest] = line.split(/\s+=\s+/);
  return { ja: ja.trim(), en: rest.join(' = ').trim() };
}

// "- question = right | wrong | wrong" -> {q, answers: [right, wrong…]} (the first answer is right)
function parseQuiz(line) {
  const at = line.search(/\s+=\s+/);
  if (at < 0) return null;
  const q = line.slice(0, at).trim();
  const answers = line.slice(at).replace(/^\s+=\s+/, '').split(/\s+\|\s+/).map((a) => a.trim()).filter(Boolean);
  return answers.length ? { q, answers } : null;
}

// "て|で + いる" -> [[{text:"て"},{text:"で"}], [{text:"いる"}]]
// each alternative: text, [pos], text[pos], or * (any word)
// A step starting with ! ("!would|could") doesn't take a word: it only checks that the word
// before the next step isn't one of those ("not after would").
function parseRule(rule, lang) {
  const steps = rule.split(/\s+\+\s+/).map((step) => step.trim()).filter(Boolean);
  if (!steps.length) throw new Error('empty rule');
  const parsed = steps.map((step) => {
    const not = step.startsWith('!');
    const alts = parseStep(not ? step.slice(1) : step, lang);
    alts.not = not;
    return alts;
  });
  if (parsed.every((s) => s.not)) throw new Error('a rule needs at least one step without !');
  return parsed;
}

function parseStep(step, lang) {
  return step.split('|').map((alt) => {
    alt = alt.trim();
    if (alt === '*') return {};
    const m = alt.match(/^([^[\]]*)(?:\[([^\]]+)\])?$/);
    if (!m || (!m[1] && !m[2])) throw new Error(`can't read "${alt}"`);
    const out = {};
    if (lang === 'en') {
      // English: a word matches as written; ~word matches any form of it (~be: am, is, was, 's…)
      const word = m[1].toLowerCase().replace(/’/g, "'");
      if (word.startsWith('~')) out.lemma = word.slice(1);
      else if (word) out.text = word;
      if (m[2]) out.pos = m[2].toLowerCase();
    } else {
      if (m[1]) out.text = m[1];
      if (m[2]) out.pos = POS[m[2].toLowerCase()] || m[2];
    }
    return out;
  });
}

function parseLesson(id, source, lang) {
  const { meta, body, problems } = splitFrontMatter(source);

  // split the body into the explanation, ## Examples and ## Quiz
  const sections = { explanation: [], examples: [], quiz: [] };
  let into = 'explanation';
  for (const line of body.split('\n')) {
    const h = line.match(/^##\s+(.*)$/);
    if (h && /^(examples?|例文)\s*$/i.test(h[1].trim())) { into = 'examples'; continue; }
    if (h && /^(quiz|練習|問題)\s*$/i.test(h[1].trim())) { into = 'quiz'; continue; }
    if (h && into !== 'explanation') into = 'explanation';
    sections[into].push(line);
  }
  const items = (lines) => lines.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, ''));

  const detect = [];
  for (const rule of meta.detect || []) {
    try { detect.push(parseRule(rule, lang)); } catch (err) { problems.push(`detect "${rule}": ${err.message}`); }
  }
  const quiz = items(sections.quiz).map(parseQuiz);
  quiz.forEach((q, i) => { if (!q) problems.push(`quiz line ${i + 1} needs "question = answer"`); });

  const title = one(meta, 'title');
  if (!title) problems.push('no title');
  return {
    id,
    title: title || id,
    meaning: one(meta, 'meaning'),
    level: one(meta, 'level') || 'other',
    order: Number(one(meta, 'order')) || 0,
    see: one(meta, 'see').split(',').map((s) => s.trim()).filter(Boolean),
    hidden: /^(yes|true)$/i.test(one(meta, 'hidden')),
    detect,
    rules: meta.detect || [],
    explanation: sections.explanation.join('\n').trim(),
    examples: items(sections.examples).map(parseExample),
    quiz: quiz.filter(Boolean),
    problems,
  };
}

const loaders = {};
for (const [lang, dir] of Object.entries(DIRS)) {
  const levels = LEVELS[lang];
  const levelRank = (l) => (levels.includes(l) ? levels.indexOf(l) : levels.length);
  loaders[lang] = folder(path.join(__dirname, '..', dir), dir, (files) => {
    const lessons = [];
    const problems = [];
    for (const { file, id, text } of files) {
      const lesson = parseLesson(id, text, lang);
      lesson.problems.forEach((p) => problems.push({ file, problem: p }));
      if (!lesson.hidden) lessons.push(lesson);
    }
    const ids = new Set(lessons.map((l) => l.id));
    for (const l of lessons) {
      l.see.filter((s) => !ids.has(s)).forEach((s) => problems.push({ file: l.id + '.md', problem: `see: no lesson called "${s}"` }));
    }
    lessons.sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.level.localeCompare(b.level)
      || a.order - b.order || a.title.localeCompare(b.title, lang));
    return { items: lessons, problems };
  });
}
const load = loaders.ja;

// ---------- finding grammar in a line ----------

function altMatches(alt, t) {
  if (alt.text && alt.text !== t.surface_form && alt.text !== t.basic_form) return false;
  if (alt.pos && ![t.pos, t.pos_detail_1, t.pos_detail_2, t.pos_detail_3].includes(alt.pos)) return false;
  return true;
}

// English pieces from server/english.js: {surface_form (lower case), basic_form, tags: Set}
function altMatchesEn(alt, t) {
  if (alt.text && alt.text !== t.surface_form) return false;
  if (alt.lemma && alt.lemma !== t.basic_form) return false;
  if (alt.pos && !t.tags.has(alt.pos)) return false;
  return true;
}

// tokens of one line (kuromoji's, or English pieces) -> [{id, start, end}] (token index range, end exclusive)
function detect(tokens, lang = 'ja') {
  const found = [];
  const matches = lang === 'en' ? altMatchesEn : altMatches;
  for (const lesson of loaders[lang]().items) {
    for (const rule of lesson.detect) {
      for (let i = 0; i < tokens.length; i++) {
        const hit = matchAt(rule, tokens, i, matches);
        if (hit) found.push({ id: lesson.id, ...hit });
      }
    }
  }
  return found;
}

// the rule starting at token i -> {start, end} (end exclusive), or null
function matchAt(rule, tokens, i, matches) {
  let at = i;
  for (const step of rule) {
    if (step.not) {
      const before = tokens[at - 1];
      if (before && step.some((alt) => matches(alt, before))) return null;
      continue;
    }
    if (at >= tokens.length || !step.some((alt) => matches(alt, tokens[at]))) return null;
    at++;
  }
  return { start: i, end: at };
}

// ---------- routes ----------

const router = express.Router();

// ---------- translations of the English lessons ----------
//
// grammar-en/pt/<lesson>.md (any language code) gives a lesson's title, meaning, explanation and
// the translations of its examples ("- English sentence = tradução") in that language, and can
// replace its quiz. Level, order, detect rules and the English examples stay in the English file.

const translations = {};
function translated(lang, native) {
  if (lang !== 'en' || !/^[a-z]{2,3}$/.test(native || '')) return null;
  const dir = `${DIRS.en}/${native}`;
  translations[dir] ||= folder(path.join(__dirname, '..', dir), dir, (files) => {
    const items = [];
    const problems = [];
    for (const { file, id, text } of files) {
      const t = parseLesson(id, text, 'en');
      t.problems.forEach((p) => problems.push({ file, problem: p }));
      items.push(t);
    }
    return { items, problems };
  });
  return translations[dir]();
}

// the lesson in the learner's language; t = its translation (or undefined)
function localize(lesson, t) {
  if (!t) return lesson;
  const tr = new Map(t.examples.map((e) => [e.ja, e.en]));
  return {
    ...lesson,
    title: t.title !== t.id ? t.title : lesson.title,
    meaning: t.meaning || lesson.meaning,
    explanation: t.explanation || lesson.explanation,
    examples: lesson.examples.map((e) => ({ ...e, en: tr.get(e.ja) ?? e.en })),
    quiz: t.quiz.length ? t.quiz : lesson.quiz,
    translated: true,
  };
}

// every lesson of a language, whole, translated when there's a translation, with all problems
// (also used by tools/check-lessons.js)
function lessons(lang, native = '') {
  const { items, problems } = loaders[lang]();
  const tr = translated(lang, native);
  if (!tr) return { items, problems };
  const byId = new Map(tr.items.map((t) => [t.id, t]));
  const extra = [...tr.problems];
  for (const t of tr.items) {
    const lesson = items.find((l) => l.id === t.id);
    if (!lesson) { extra.push({ file: `${native}/${t.id}.md`, problem: 'no English lesson with this name' }); continue; }
    const english = new Set(lesson.examples.map((e) => e.ja));
    t.examples.filter((e) => !english.has(e.ja))
      .forEach((e) => extra.push({ file: `${native}/${t.id}.md`, problem: `example "${e.ja}" isn't in the English lesson` }));
  }
  return { items: items.map((l) => localize(l, byId.get(l.id))), problems: [...problems, ...extra] };
}

const forLang = (req) => lessons(req.query.lang === 'en' ? 'en' : 'ja', String(req.query.native || ''));

router.get('/', (req, res) => {
  const { items, problems } = forLang(req);
  res.json({ lessons: items.map(({ id, title, meaning, level, order, see }) => ({ id, title, meaning, level, order, see })), problems });
});

router.get('/:id', (req, res) => {
  const lesson = forLang(req).items.find((l) => l.id === req.params.id);
  if (!lesson) return res.status(404).json({ error: `no lesson called ${req.params.id}` });
  const { detect: _, problems: __, ...l } = lesson;
  res.json(l);
});

module.exports = { router, detect, load, lessons };
