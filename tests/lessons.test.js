// Lesson and course files: the settings-block reader, the lesson/course APIs, translations, and
// the full lesson check (every lesson's detect rules still find its own examples).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { splitFrontMatter, one } = require('../server/mdfolder');
const grammar = require('../server/grammar');
const course = require('../server/course');

// call an Express route handler directly: {query, params} -> what it sends
function call(router, routePath, query, params = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath);
  let sent = null;
  let status = 200;
  const res = { json: (x) => { sent = x; return res; }, status: (s) => { status = s; return res; } };
  layer.route.stack[0].handle({ query, params }, res);
  return { status, body: sent };
}

test('settings blocks: repeated keys, comments, missing block', () => {
  const { meta, body, problems } = splitFrontMatter('---\ntitle: A\n# a comment: ignored\ndetect: x\ndetect: y\n---\nhello');
  assert.deepEqual(meta.detect, ['x', 'y']);
  assert.equal(one(meta, 'title'), 'A');
  assert.equal(meta.a, undefined);
  assert.equal(body, 'hello');
  assert.deepEqual(problems, []);
  assert.equal(splitFrontMatter('no block').problems.length, 1);
});

test('the lesson list is small; a lesson comes whole from its own route', () => {
  const list = call(grammar.router, '/', { lang: 'ja' }).body;
  assert.ok(list.lessons.length >= 100);
  assert.deepEqual(Object.keys(list.lessons[0]).sort(), ['id', 'level', 'meaning', 'order', 'see', 'title']);
  const lesson = call(grammar.router, '/:id', { lang: 'ja' }, { id: 'te-iru' }).body;
  assert.ok(lesson.explanation && lesson.examples.length && lesson.quiz.length && lesson.rules.length);
  assert.equal(call(grammar.router, '/:id', { lang: 'ja' }, { id: 'nope' }).status, 404);
});

test('Japanese levels come in N5 → N1 order, English in A1 → C1', () => {
  const levels = (lang) => [...new Set(call(grammar.router, '/', { lang }).body.lessons.map((l) => l.level))];
  assert.deepEqual(levels('ja'), ['N5', 'N4', 'N3', 'N2', 'N1']);
  assert.deepEqual(levels('en'), ['A1', 'A2', 'B1', 'B2', 'C1']);
});

test('English lessons come translated, with the English examples kept', () => {
  const pt = call(grammar.router, '/:id', { lang: 'en', native: 'pt' }, { id: 'present-perfect' }).body;
  assert.equal(pt.translated, true);
  assert.match(pt.explanation, /passado/);
  assert.equal(pt.examples[0].ja, 'Have you ever eaten sushi?');
  assert.equal(pt.examples[0].en, 'Você já comeu sushi?');
  assert.ok(pt.rules.length, 'detect rules still come from the English file');
  // a language without translations gets the English lesson
  const fr = call(grammar.router, '/:id', { lang: 'en', native: 'fr' }, { id: 'present-perfect' }).body;
  assert.equal(fr.translated, undefined);
});

test('the course: one per language, translated steps keep the English goals', () => {
  assert.equal(call(course.router, '/', { lang: 'ja' }).body.steps.length, 8);
  const es = call(course.router, '/', { lang: 'en', native: 'es' }).body.steps;
  const en = call(course.router, '/', { lang: 'en' }).body.steps;
  const words = (steps) => steps.find((s) => s.id === 'core-words');
  assert.notEqual(words(es).title, words(en).title);
  assert.deepEqual(words(es).goals.map((g) => [g.kind, g.target]), words(en).goals.map((g) => [g.kind, g.target]));
});

test('the N5 grammar lessons come in Portuguese and Spanish: examples kept, quiz answers unchanged', () => {
  const ja = grammar.lessons('ja').items;
  for (const native of ['pt', 'es']) {
    const { items } = grammar.lessons('ja', native);
    for (const l of items.filter((x) => x.level === 'N5')) {
      const orig = ja.find((x) => x.id === l.id);
      assert.equal(l.translated, true, `${native}/${l.id}`);
      assert.notEqual(l.meaning, orig.meaning, `${native}/${l.id}: meaning translated`);
      assert.deepEqual(l.examples.map((e) => e.ja), orig.examples.map((e) => e.ja), `${native}/${l.id}: same Japanese examples`);
      l.examples.forEach((e, i) => assert.notEqual(e.en, orig.examples[i].en, `${native}/${l.id}: example ${i + 1} translated`));
      assert.deepEqual(l.quiz.map((q) => q.answers), orig.quiz.map((q) => q.answers), `${native}/${l.id}: same quiz answers`);
    }
    // other levels stay in English for now
    assert.equal(items.find((x) => x.id === 'zaru-wo-enai').translated, undefined);
  }
});

test('the Japanese course comes in Portuguese and Spanish, with every step and goal label translated', () => {
  const ja = call(course.router, '/', { lang: 'ja' }).body.steps;
  for (const native of ['pt', 'es']) {
    const { steps, problems } = call(course.router, '/', { lang: 'ja', native }).body;
    assert.deepEqual(problems, [], native);
    assert.deepEqual(steps.map((s) => s.id), ja.map((s) => s.id), `${native}: same steps, same order`);
    steps.forEach((s, i) => {
      assert.equal(s.translated, true, `${native}/${s.id} is translated`);
      assert.notEqual(s.title, ja[i].title, `${native}/${s.id}: title`);
      assert.deepEqual(s.goals.map((g) => [g.kind, g.target ?? g.level]), ja[i].goals.map((g) => [g.kind, g.target ?? g.level]), `${native}/${s.id}: same goals`);
      s.goals.forEach((g, k) => assert.notEqual(g.label, ja[i].goals[k].label, `${native}/${s.id}: goal label translated`));
    });
  }
  // links into the app are kept
  const pt = call(course.router, '/', { lang: 'ja', native: 'pt' }).body.steps.find((s) => s.id === 'grammar-basics');
  assert.match(pt.body, /\/grammar\.html#te-iru/);
  // Settings lists the languages each course is translated into
  assert.deepEqual(call(course.router, '/languages', { lang: 'ja' }).body.languages, ['es', 'pt']);
  assert.deepEqual(call(course.router, '/languages', { lang: 'en' }).body.languages, ['es', 'ja', 'pt']);
});

test('every lesson and course file passes npm run check-lessons', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'check-lessons.js')], { encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, run.stdout.split('\n').filter((l) => l.includes('✗')).join('\n'));
});
