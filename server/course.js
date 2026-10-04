// The course: one Markdown file per step in ./course (learning Japanese) and ./course-en
// (learning English); see course/README.md
//
//   GET /api/course[?lang=en][&native=pt]   -> {steps: [...], problems: [...]}
//   GET /api/course/languages[?lang=en]     -> {languages: ["es", "pt"]}: the translations there are
//
// Both courses can be translated: course/pt/<step>.md or course-en/pt/<step>.md (any language code)
// replaces the title, summary, when, text and goal labels of that step for people whose language
// is pt (Settings → Your language). The order and the goals stay in the English file. Untranslated
// steps are shown in English.
//
// Edits show up on the next page load without restarting the server (server/mdfolder.js).
// Steps can have `goal:` lines that the course page checks against what you've done in the app.

const fs = require('fs');
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

// course/pt, course-en/es…: made on first use
const translations = {};
function translated(lang, native) {
  if (!/^[a-z]{2,3}$/.test(native)) return null;
  const dir = `${DIRS[lang]}/${native}`;
  translations[dir] ||= folder(path.join(__dirname, '..', dir), dir, build);
  return translations[dir]();
}

// do a translation's goal lines match the English file's (same kinds and targets, same order)?
const sameGoals = (a, b) => a.length === b.length
  && a.every((g, i) => g.kind === b[i].kind && (g.target ?? g.level) === (b[i].target ?? b[i].level));

// the step in the learner's language, keeping the English file's order and goals
function localize(step, t) {
  if (!t) return step;
  const goals = sameGoals(t.goals, step.goals)
    ? step.goals.map((g, i) => ({ ...g, label: t.goals[i].label || g.label }))     // translated goal labels
    : step.goals;
  // a translation without its own title (parseStep falls back to the file name) keeps the English one
  return { ...step, title: t.title !== t.id ? t.title : step.title, summary: t.summary || step.summary, when: t.when || step.when, body: t.body, goals, translated: true };
}

const router = express.Router();

// which translations a course has (its language-code folders), for Settings → Your language
router.get('/languages', (req, res) => {
  const dir = path.join(__dirname, '..', DIRS[req.query.lang === 'en' ? 'en' : 'ja']);
  const languages = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z]{2,3}$/.test(d.name)).map((d) => d.name).sort();
  res.json({ languages });
});

router.get('/', (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'ja';
  const { items, problems } = loaders[lang]();
  const tr = translated(lang, String(req.query.native || ''));
  const byId = new Map(((tr && tr.items) || []).map((s) => [s.id, s]));
  const steps = items.map((s) => localize(s, byId.get(s.id)));
  // a translation's goal lines must match the English file's, or their labels can't be used
  const mismatched = items.filter((s) => byId.has(s.id) && !sameGoals(byId.get(s.id).goals, s.goals))
    .map((s) => ({ file: `${DIRS[lang]}/${req.query.native}/${s.id}.md`, problem: "its goal lines don't match the English file's (same kinds and numbers, same order): the labels stay in English" }));
  res.json({ steps: steps.map(({ problems: _, hidden: __, ...s }) => s), problems: [...problems, ...((tr && tr.problems) || []), ...mismatched] });
});

module.exports = { router };
