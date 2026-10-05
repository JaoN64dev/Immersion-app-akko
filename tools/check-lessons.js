// Checks every grammar lesson (grammar/ and grammar-en/) and course step:
//   - the files can be read (settings block, title, detect rules, quiz lines, see: links, goals)
//   - each lesson's detect rules find the grammar in all of its own examples
//   - every quiz question has an answer
//
//   npm run check-lessons              (exits with 1 if something is wrong)
//   npm run check-lessons -- --verbose (also lists examples that other lessons underline too)
//
// Run it after editing lessons: a rule that no longer matches its examples would otherwise just
// silently stop underlining that grammar.

const fs = require('fs');
const path = require('path');
const kuromoji = require('kuromoji');
const grammar = require('../server/grammar');
const english = require('../server/english');

const ROOT = path.join(__dirname, '..');
const verbose = process.argv.includes('--verbose');
let failures = 0;

const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

function tokenizerJa() {
  const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
  return new Promise((resolve, reject) => kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t))));
}

// ids of the lessons found in one sentence
function finderFor(lang, ja, dict) {
  if (lang === 'ja') return (text) => new Set(grammar.detect(ja.tokenize(text), 'ja').map((f) => f.id));
  return (text) => new Set(english.tokenize(text, dict).flatMap((t) => t.gr || []));
}

function checkLessons(lang, find) {
  const { items, problems } = grammar.lessons(lang);
  console.log(`\n${lang === 'ja' ? 'grammar/' : 'grammar-en/'}: ${items.length} lessons`);
  problems.forEach((p) => fail(`${p.file}: ${p.problem}`));
  let checked = 0;
  for (const l of items) {
    l.quiz.forEach((q, i) => { if (!q.answers.length) fail(`${l.id}.md: quiz ${i + 1} has no answer`); });
    if (!l.detect.length) continue;
    checked++;
    if (!l.examples.length) fail(`${l.id}.md: has detect rules but no examples to check them with`);
    for (const ex of l.examples) {
      const found = find(ex.ja);
      if (!found.has(l.id)) fail(`${l.id}.md: the detect rules don't find it in "${ex.ja}"`);
      const others = [...found].filter((id) => id !== l.id);
      if (verbose && others.length) console.log(`  · ${l.id}: "${ex.ja}" is also underlined as ${others.join(', ')}`);
    }
  }
  console.log(`  ${checked} lessons with detect rules checked against their examples`);
}

// grammar-en/pt, /es…: each translated lesson must match an English one, with the same examples
function checkTranslations() {
  for (const [lang, folder] of [['ja', 'grammar'], ['en', 'grammar-en']]) {
    const dir = path.join(ROOT, folder);
    for (const code of fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const main = grammar.lessons(lang).problems.length;
      const { items, problems } = grammar.lessons(lang, code);
      const translated = items.filter((l) => l.translated).length;
      console.log(`\n${folder}/${code}: ${translated} of ${items.length} lessons translated`);
      problems.slice(main).forEach((p) => fail(`${folder}/${p.file}: ${p.problem}`));
    }
  }
}

function checkCourse() {
  const course = require('../server/course');
  const handler = course.router.stack.find((l) => l.route && l.route.path === '/').route.stack[0].handle;
  const translationsOf = (lang, dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => [lang, d.name]);
  for (const [lang, native] of [['ja', ''], ['en', ''], ...translationsOf('ja', 'course'), ...translationsOf('en', 'course-en')]) {
    handler({ query: { lang, native } }, {
      json: ({ steps, problems }) => {
        console.log(`\ncourse${lang === 'en' ? '-en' : ''}${native ? '/' + native : ''}: ${steps.length} steps`);
        problems.forEach((p) => fail(`${p.file}: ${p.problem}`));
      },
    });
  }
}

(async () => {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dict.json'), 'utf8'));
  const ja = await tokenizerJa();
  checkLessons('ja', finderFor('ja', ja));
  checkLessons('en', finderFor('en', null, dict));
  checkTranslations();
  checkCourse();
  console.log(failures ? `\n${failures} problem(s) found` : '\nall good');
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
