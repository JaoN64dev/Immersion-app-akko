// The course: one Markdown file per step in ./course (learning Japanese) and ./course-en
// (learning English); see course/README.md
//
//   GET /api/course[?lang=en][&native=pt]   -> {steps: [...], problems: [...]}
//
// The English course can be translated: course-en/pt/<step>.md (any language code) replaces the
// title, summary, when and text of that step for people whose language is pt. The order and the
// goals stay in the English file. Untranslated steps are shown in English.
//
// Edits show up on the next page load without restarting the server (server/mdfolder.js).
// Steps can have `goal:` lines that the course page checks against what you've done in the app.

const path = require('path');
const express = require('express');
const { splitFrontMatter, one, folder } = require('./mdfolder');

const DIRS = { ja: 'course', en: 'course-en' };

// goal kinds the course page knows how to measure (scripts/pages/course.js)
const GOALS = ['words', 'grammar', 'mined', 'read', 'manga', 'hours'];

// "words 300" / "grammar N5" / "hours 20 | 20 hours of Japanese" -> {kind, target, label}
function parseGoal(line) {
  const [what, label = ''] = line.split('|').map((s) => s.trim());
  const [kind, target] = what.split(/\s+/);
  if (!GOALS.includes(kind)) throw new Error(`unknown goal "${kind}" (use ${GOALS.join(', ')})`);
  if (!target) throw new Error(`goal "${kind}" needs a number${kind === 'grammar' ? ' or a level' : ''}`);
  if (kind === 'grammar') return { kind, level: target, label };
  if (!(Number(target) > 0)) throw new Error(`goal "${kind}": "${target}" isn't a number`);
  return { kind, target: Number(target), label };
}

function parseStep(id, source) {
  const { meta, body, problems } = splitFrontMatter(source);
  const goals = [];
  for (const g of meta.goal || []) {
    try { goals.push(parseGoal(g)); } catch (err) { problems.push(err.message); }
  }
  const title = one(meta, 'title');
  if (!title) problems.push('no title');
  return {
    id,
    title: title || id,
    summary: one(meta, 'summary'),
    when: one(meta, 'when'),
    order: Number(one(meta, 'order')) || 0,
    hidden: /^(yes|true)$/i.test(one(meta, 'hidden')),
    goals,
    body: body.trim(),
    problems,
  };
}

function build(files) {
  const steps = [];
  const problems = [];
  for (const { file, id, text } of files) {
    const step = parseStep(id, text);
    step.problems.forEach((p) => problems.push({ file, problem: p }));
    if (!step.hidden) steps.push(step);
  }
  steps.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { items: steps, problems };
}
const loaders = Object.fromEntries(Object.entries(DIRS).map(([lang, dir]) => [lang, folder(path.join(__dirname, '..', dir), dir, build)]));

// course-en/pt, course-en/es…: made on first use
const translations = {};
function translated(lang, native) {
  if (lang !== 'en' || !/^[a-z]{2,3}$/.test(native)) return null;
  const dir = `${DIRS[lang]}/${native}`;
  translations[dir] ||= folder(path.join(__dirname, '..', dir), dir, build);
  return translations[dir]();
}

// the step in the learner's language, keeping the English file's order and goals
function localize(step, t) {
  if (!t) return step;
  const goals = t.goals.length === step.goals.length
    ? step.goals.map((g, i) => ({ ...g, label: t.goals[i].label || g.label }))     // translated goal labels
    : step.goals;
  // a translation without its own title (parseStep falls back to the file name) keeps the English one
  return { ...step, title: t.title !== t.id ? t.title : step.title, summary: t.summary || step.summary, when: t.when || step.when, body: t.body, goals, translated: true };
}

const router = express.Router();

router.get('/', (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'ja';
  const { items, problems } = loaders[lang]();
  const tr = translated(lang, String(req.query.native || ''));
  const byId = new Map(((tr && tr.items) || []).map((s) => [s.id, s]));
  const steps = items.map((s) => localize(s, byId.get(s.id)));
  res.json({ steps: steps.map(({ problems: _, hidden: __, ...s }) => s), problems: [...problems, ...((tr && tr.problems) || [])] });
});

module.exports = { router };
