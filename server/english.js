// English, for learning American English (lang=en on /api/tokenize, /api/dict, /api/audio):
//
//   - splitting text into words, with contractions (don't, I'm) and the dictionary form of
//     each word (went -> go, studies -> study) from irregular tables + suffix rules
//   - offline: English definitions from WordNet (server/wordnet.js), American IPA from the CMU
//     Pronouncing Dictionary (server/cmudict.js), Japanese translations by looking JMdict up backwards
//   - online, saved on disk once fetched: translations into the learner's language (Wiktionary)
//     and American recordings (Wikimedia Commons). The popup works without them.
//
// The word lists are built the first time English is used (a second or two), so they're only
// in memory when someone learns English.

const fs = require('fs');
const path = require('path');
const { fetchBuffer } = require('./http');
const grammar = require('./grammar');
const wordnet = require('./wordnet');
const cmudict = require('./cmudict');

// ---------- irregular forms ----------

// "base past participle", / for two forms
const IRREGULAR_VERBS = `arise arose arisen; awake awoke awoken; be was/were been; bear bore born/borne; beat beat beaten;
become became become; begin began begun; bend bent bent; bet bet bet; bid bid bid; bind bound bound; bite bit bitten;
bleed bled bled; blow blew blown; break broke broken; breed bred bred; bring brought brought; broadcast broadcast broadcast;
build built built; burn burnt/burned burnt/burned; burst burst burst; buy bought bought; catch caught caught;
choose chose chosen; cling clung clung; come came come; cost cost cost; creep crept crept; cut cut cut; deal dealt dealt;
dig dug dug; do did done; draw drew drawn; dream dreamt/dreamed dreamt/dreamed; drink drank drunk; drive drove driven;
eat ate eaten; fall fell fallen; feed fed fed; feel felt felt; fight fought fought; find found found; flee fled fled;
fly flew flown; forbid forbade forbidden; forecast forecast forecast; forget forgot forgotten; forgive forgave forgiven;
freeze froze frozen; get got gotten/got; give gave given; go went gone; grind ground ground; grow grew grown;
hang hung hung; have had had; hear heard heard; hide hid hidden; hit hit hit; hold held held; hurt hurt hurt;
keep kept kept; kneel knelt knelt; know knew known; lay laid laid; lead led led; lean leaned/leant leaned/leant;
leap leapt/leaped leapt/leaped; learn learned/learnt learned/learnt; leave left left; lend lent lent; let let let;
lie lay lain; light lit lit; lose lost lost; make made made; mean meant meant; meet met met; mistake mistook mistaken;
overcome overcame overcome; pay paid paid; prove proved proven; put put put; quit quit quit; read read read;
ride rode ridden; ring rang rung; rise rose risen; run ran run; say said said; see saw seen; seek sought sought;
sell sold sold; send sent sent; set set set; sew sewed sewn; shake shook shaken; shine shone shone; shoot shot shot;
show showed shown; shrink shrank shrunk; shut shut shut; sing sang sung; sink sank sunk; sit sat sat; sleep slept slept;
slide slid slid; speak spoke spoken; speed sped sped; spend spent spent; spin spun spun; spit spat spat; split split split;
spread spread spread; spring sprang sprung; stand stood stood; steal stole stolen; stick stuck stuck; sting stung stung;
stink stank stunk; strike struck struck; swear swore sworn; sweep swept swept; swim swam swum; swing swung swung;
take took taken; teach taught taught; tear tore torn; tell told told; think thought thought; throw threw thrown;
understand understood understood; undergo underwent undergone; upset upset upset; wake woke woken; wear wore worn;
weep wept wept; win won won; wind wound wound; withdraw withdrew withdrawn; write wrote written`;

// word -> {lemma, tags}
const FORMS = new Map();
const IRREGULAR_BASES = new Set();
for (const entry of IRREGULAR_VERBS.split(';')) {
  const [base, past, pp] = entry.trim().split(/\s+/);
  IRREGULAR_BASES.add(base);
  const add = (form, tag) => {
    const hit = FORMS.get(form);
    if (hit && hit.lemma === base) hit.tags.push(tag);
    else if (!hit) FORMS.set(form, { lemma: base, tags: [tag] });
  };
  past.split('/').forEach((f) => add(f, 'past'));
  pp.split('/').forEach((f) => add(f, 'pp'));
}
// "been" isn't tagged pp, so "it's been raining" doesn't look like a passive (be + pp)
FORMS.set('been', { lemma: 'be', tags: ['been'] });
// forms of be / have / do
for (const [form, lemma, tags] of [
  ['am', 'be', ['present']], ['is', 'be', ['present', 's']], ['are', 'be', ['present']], ['being', 'be', ['ing']],
  ['has', 'have', ['s']], ['having', 'have', ['ing']], ['does', 'do', ['s']], ['doing', 'do', ['ing']],
]) FORMS.set(form, { lemma, tags });
for (const [form, lemma] of [
  ['men', 'man'], ['women', 'woman'], ['children', 'child'], ['feet', 'foot'], ['teeth', 'tooth'], ['mice', 'mouse'],
  ['geese', 'goose'], ['lives', 'life'], ['wives', 'wife'], ['knives', 'knife'], ['leaves', 'leaf'], ['halves', 'half'],
  ['wolves', 'wolf'], ['shelves', 'shelf'], ['thieves', 'thief'],
]) FORMS.set(form, { lemma, tags: ['s'] });
for (const [form, lemma, tag] of [
  ['better', 'good', 'er'], ['best', 'good', 'est'], ['worse', 'bad', 'er'], ['worst', 'bad', 'est'],
  ['further', 'far', 'er'], ['farther', 'far', 'er'], ['furthest', 'far', 'est'],
]) FORMS.set(form, { lemma, tags: [tag] });

// contractions: the ending, what it stands for, and its tags
const CONTRACTIONS = [
  [/^(.+)n't$/, "n't", 'not'],
  [/^(.+)'m$/, "'m", 'be'],
  [/^(.+)'re$/, "'re", 'be'],
  [/^(.+)'ve$/, "'ve", 'have'],
  [/^(.+)'ll$/, "'ll", 'will'],
  [/^(.+)'d$/, "'d", 'would'],
  [/^(.+)'s$/, "'s", 'be'],         // is / has / possessive: grammar rules can tell by what follows
];
// stems of n't contractions that aren't words themselves (don't, didn't, isn't… already are)
const NT_STEMS = { ca: 'can', wo: 'will', sha: 'shall', ai: 'am' };

// small closed groups that grammar rules can use as [modal], [pronoun]…
// After these, an irregular form that is also a word of its own is that word: "the ground",
// "a wound", "to lay", "can lay" (not grind / wind / lie)
const OWN_WORD_AFTER = new Set(['a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'to', 'please', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'do', 'does', "don't", "let's"]);

const DETERMINERS = new Set(['a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that',
  'these', 'those', 'every', 'each', 'no', 'some', 'any', 'another']);

const CLASSES = {
  modal: ['can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', "'ll", "'d"],
  pronoun: ['i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'this', 'that', 'there'],
  wh: ['what', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'which'],
  article: ['a', 'an', 'the'],
};

// grammar words: clickable, but they don't count as words you know or don't know
const FUNCTION_WORDS = new Set(`a an the and or but nor so yet if because as than that this these those there here
i you he she it we they me him her us them my your his its our their mine yours hers ours theirs myself yourself
of to in on at by for with from about into onto over under up down out off through after before since until till
be am is are was were been being have has had having do does did doing done not n't 'm 're 've 'll 'd 's
can could will would shall should may might must also too very just only oh uh um ok okay yes no`.split(/\s+/));

// ---------- the word list (from JMdict's English glosses) ----------

let vocab = null;       // { index: Map(word -> [entry*16 + sense]), verbs, adjectives, nouns }

const keyOf = (gloss) => gloss.toLowerCase()
  .replace(/\([^)]*\)/g, ' ')            // "run (of a machine)" -> "run"
  .replace(/^(to|a|an|the)\s+/, '')
  .replace(/[^a-z' -]/g, ' ')
  .replace(/\s+/g, ' ').trim();

function buildVocab(dict) {
  if (vocab) return vocab;
  const started = Date.now();
  // JMdict backwards: English gloss -> Japanese entries (for Japanese translations)
  const index = new Map();
  dict.entries.forEach((e, i) => {
    e.s.forEach((sense, k) => {
      if (k > 15) return;
      for (const g of sense.g) {
        const key = keyOf(g);
        if (!key || key.split(' ').length > 3) continue;
        const list = index.get(key);
        if (list) list.push(i * 16 + k); else index.set(key, [i * 16 + k]);
      }
    });
  });
  // which words are real nouns / verbs / adjectives: WordNet
  const wn = wordnet.sets();
  const verbs = new Set([...wn.verb, ...IRREGULAR_BASES]);
  vocab = { index, verbs, adjectives: wn.adj, nouns: wn.noun, adverbs: wn.adv };
  console.log(`english: ${index.size} words ready (${Date.now() - started} ms)`);
  return vocab;
}

const known = (w) => vocab.index.has(w) || vocab.nouns.has(w) || vocab.verbs.has(w) || vocab.adjectives.has(w) || vocab.adverbs.has(w);

// ---------- dictionary form ----------

// "studies" -> {lemma: "study", tags: ["s"]}; tags: s, ing, past, pp, er, est
function lemmatize(word) {
  const w = word.toLowerCase();
  const irregular = FORMS.get(w);
  if (irregular) return { lemma: irregular.lemma, tags: [...irregular.tags] };
  const { verbs, adjectives, nouns } = vocab;
  const tags = [];
  if (IRREGULAR_BASES.has(w)) return { lemma: w, tags };     // (come, run, put… as participles are in FORMS)
  const undouble = (s) => (/([bcdfgklmnprstvz])\1$/.test(s) ? s.slice(0, -1) : null);
  const first = (cands, set) => cands.find((c) => c && c.length > 1 && set.has(c));

  if (w.endsWith('ing') && w.length > 4) {
    const stem = w.slice(0, -3);
    const v = first([stem, stem + 'e', undouble(stem), w.endsWith('ying') ? w.slice(0, -4) + 'ie' : null], verbs);
    // "evening" is a noun far more often than "even" is a verb; "running" is mostly "run"
    // "interesting", "boring", "amazing" are adjectives of their own; a very common verb wins ("running")
    const own = (nouns.has(w) && wordnet.frequency('noun', w) > wordnet.frequency('verb', v))
      || (adjectives.has(w) && wordnet.frequency('adj', w) > 0 && wordnet.frequency('verb', v) <= 3);
    if (v && !own) return { lemma: v, tags: ['ing'] };
  }
  if (w.endsWith('ed') && w.length > 3) {
    const stem = w.slice(0, -2);
    const v = first([stem, w.slice(0, -1), undouble(stem), w.endsWith('ied') ? w.slice(0, -3) + 'y' : null], verbs);
    if (v) return { lemma: v, tags: ['past', 'pp', 'ed'] };
  }
  if (/(er|est)$/.test(w) && w.length > 4) {
    const cut = w.endsWith('est') ? 3 : 2;
    const stem = w.slice(0, -cut);
    const a = first([stem, stem + 'e', undouble(stem), stem.endsWith('i') ? stem.slice(0, -1) + 'y' : null], adjectives);
    if (a) return { lemma: a, tags: [cut === 3 ? 'est' : 'er'] };
  }
  if (w.endsWith('s') && w.length > 3 && !/(ss|us|is)$/.test(w)) {
    const nounOrVerb = { has: (c) => nouns.has(c) || verbs.has(c) };
    const base = first([w.endsWith('ies') ? w.slice(0, -3) + 'y' : null, w.endsWith('es') ? w.slice(0, -2) : null, w.slice(0, -1)], nounOrVerb);
    if (base) return { lemma: base, tags: ['s'] };
  }
  return { lemma: w, tags };
}

// "don't" -> [{text: "do", lemma: "do"}, {text: "n't", lemma: "not"}]
function splitContraction(lower) {
  for (const [re, ending, means] of CONTRACTIONS) {
    const m = lower.match(re);
    if (!m) continue;
    // can't -> "can" + "n't", won't -> "will" + "n't": rules see the real word
    const stem = ending === "n't" && NT_STEMS[m[1]] ? NT_STEMS[m[1]] : m[1];
    const head = lemmatize(stem);
    return [{ text: stem, ...head }, { text: ending, lemma: means, tags: ['contraction'] }];
  }
  return null;
}

// tags a grammar rule can match in [brackets]
function wordTags(text, lemma, tags) {
  const out = new Set(tags);
  if (vocab.verbs.has(lemma)) {
    out.add('verb');
    if (text === lemma) out.add('base');      // "can swim": the bare verb
  }
  if (vocab.adjectives.has(lemma) || vocab.adjectives.has(text)) out.add('adj');
  if (vocab.nouns.has(lemma)) out.add('noun');
  if (/ly$/.test(text) && text.length > 4) out.add('adv');
  for (const [name, words] of Object.entries(CLASSES)) if (words.includes(text) || words.includes(lemma)) out.add(name);
  return out;
}

// ---------- tokenizing ----------

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*/g;

// One line -> tokens like the Japanese ones: {s, b, c?, n?, gr?}
function tokenizeLine(line, sentenceStart) {
  const out = [];
  const raw = [];           // pieces for grammar detection: {surface_form, basic_form, tags}
  const rawWord = [];       // piece -> index in out
  let at = 0;
  let start = sentenceStart;
  let previous = '';          // the word before, lower case
  const push = (text) => { if (text) out.push({ s: text }); };
  for (const m of line.matchAll(WORD)) {
    const before = line.slice(at, m.index);
    push(before);
    if (/[.!?]/.test(before)) start = true;
    at = m.index + m[0].length;
    const word = m[0];
    if (/^\d/.test(word)) { out.push({ s: word }); start = false; continue; }

    const lower = word.toLowerCase().replace(/’/g, "'");
    let parts = splitContraction(lower);
    // after a determiner an -ing word that is also a noun is that noun: "the meeting", "a painting"
    if (!parts && lower.endsWith('ing') && DETERMINERS.has(previous) && vocab.nouns.has(lower)) parts = [{ text: lower, lemma: lower, tags: [] }];
    if (!parts) {
      // only verb forms ("the best" stays a superlative of good)
      const verbForm = FORMS.has(lower) && FORMS.get(lower).tags.some((t) => t === 'past' || t === 'pp');
      const own = verbForm && OWN_WORD_AFTER.has(previous) && (vocab.nouns.has(lower) || IRREGULAR_BASES.has(lower));
      parts = [{ text: lower, ...(own ? { lemma: lower, tags: [] } : lemmatize(lower)) }];
    }
    previous = lower;
    const head = parts[0];
    const capital = /^[A-Z]/.test(word) && lower !== 'i';
    const isName = capital && !start && !known(head.lemma) && !known(lower);
    const lemma = head.lemma === 'i' ? 'I' : head.lemma;
    const tok = { s: word, b: isName ? word : lemma };
    if (isName) tok.n = 1;
    else if (!FUNCTION_WORDS.has(lower) && !FUNCTION_WORDS.has(head.lemma)) tok.c = 1;
    out.push(tok);
    for (const p of parts) {
      raw.push({ surface_form: p.text, basic_form: p.lemma, tags: wordTags(p.text, p.lemma, p.tags) });
      rawWord.push(out.length - 1);
    }
    start = false;
  }
  push(line.slice(at));

  for (const { id, start: from, end } of grammar.detect(raw, 'en')) {
    for (let k = from; k < end; k++) {
      const tok = out[rawWord[k]];
      if (tok && tok.b && !(tok.gr ||= []).includes(id)) tok.gr.push(id);
    }
  }
  return out;
}

function tokenize(text, dict) {
  buildVocab(dict);
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (i) out.push({ s: '\n' });
    out.push(...tokenizeLine(line, i === 0 || /[.!?]["”')]*\s*$/.test(text.split('\n')[i - 1])));
  });
  return out;
}

// ---------- looking up ----------

const LABELS = {
  s: 'plural / -s', ing: '-ing form', past: 'past', pp: 'past participle', er: 'comparative (-er)',
  est: 'superlative (-est)', present: 'present',
};

// Japanese words whose English glosses are this word, best first
function japaneseFor(word, dict) {
  const hits = vocab.index.get(word) || [];
  const scored = [];
  const seen = new Set();
  for (const code of hits) {
    const i = Math.floor(code / 16), k = code % 16;
    const e = dict.entries[i];
    const sense = e.s[k];
    if (!sense || seen.has(i)) continue;
    seen.add(i);
    const exact = sense.g.findIndex((g) => keyOf(g) === word);
    // "to go" / "go" as written, rather than "go (board game)"
    const plain = sense.g.some((g) => { const l = g.toLowerCase(); return l === word || l === `to ${word}`; });
    // common words, early senses, plain glosses and the word's place in the list; basic words have many senses
    const score = (e.c ? 0 : 40) + k * 6 + Math.min(sense.g.length, 6) / 2 + (exact < 0 ? 10 : exact * 2)
      + (plain ? 0 : 6) + (e.k.length ? 0 : 3) - Math.min(e.s.length, 10);
    scored.push({ e, sense, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, 8).map(({ e, sense }) => ({
    pos: [sense.g.slice(0, 3).join('; ')],
    gloss: [e.k.length ? `${e.k[0]}【${e.r[0]}】` : e.r[0]],
    misc: [],
    common: !!e.c,
  }));
}

// ---------- online extras: translations (Wiktionary) and recordings (Wikimedia Commons) ----------
//
// Definitions (WordNet) and American IPA (CMU) are offline. Only translations into the learner's
// language and the recordings need the internet. Their answers are kept on disk
// (data/english-online.json), so each word is fetched once, ever; failed requests aren't kept.
// Requests to Wikimedia go one at a time, and wait when it says "too many requests" (429).

const WIKT = 'https://en.wiktionary.org';
// Wikimedia asks API users to say who they are
const WIKI_UA = 'akko-immersion/1.0 (https://github.com/JaoN64dev/japaneselocalwebapp; local learning app)';
const ONLINE_FILE = path.join(require('./paths').DATA, 'english-online.json');
const KEEP = 90 * 24 * 3600e3;          // a saved answer is refreshed after 90 days
const MAX_SAVED = 30000;                // words kept on disk

let saved = null;                        // key -> {v: value, t: when}
let saveTimer = null;

function savedAnswers() {
  if (saved) return saved;
  try { saved = new Map(Object.entries(JSON.parse(fs.readFileSync(ONLINE_FILE, 'utf8')))); } catch { saved = new Map(); }
  return saved;
}

function remember(key, value) {
  const all = savedAnswers();
  all.delete(key);
  all.set(key, { v: value, t: Date.now() });
  while (all.size > MAX_SAVED) all.delete(all.keys().next().value);     // oldest first
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.promises.writeFile(ONLINE_FILE, JSON.stringify(Object.fromEntries(all))).catch((err) => console.warn('english: saving', err.message));
  }, 3000);
}

// the saved answer, or fn()'s (saved when it works; an error is thrown, not saved)
async function onDisk(key, fn) {
  const hit = savedAnswers().get(key);
  if (hit && Date.now() - hit.t < KEEP) return hit.v;
  const value = await fn();
  remember(key, value);
  return value;
}

// one Wikimedia request at a time, a little apart; on 429 wait (Retry-After) and try again
let line = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function politely(url) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA }, signal: AbortSignal.timeout(8000) });
      if (res.status === 429 && attempt < 2) {
        await sleep(Math.min(Number(res.headers.get('retry-after')) || 5, 20) * 1000);
        continue;
      }
      await sleep(150);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
      return res.json();
    }
  };
  const result = line.then(run, run);
  line = result.catch(() => {});
  return result;
}

// One page's source ('' if there's no such page)
async function wiktPage(title) {
  const data = await politely(`${WIKT}/w/api.php?` + new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', format: 'json', formatversion: '2' }));
  return data && data.parse ? data.parse.wikitext : '';
}

// only the English section of a page (it also has other languages spelled the same)
const englishSection = (text) => (text.split(/\n==English==\n/)[1] || (text.startsWith('==English==') ? text : '')).split(/\n==[^=]/)[0];

// American pronunciation from Wiktionary, for words the CMU dictionary doesn't have: {{IPA|en|/ɡoʊ/|a=GA}}
function ipaFrom(english) {
  const lines = english.split('\n').filter((l) => l.includes('{{IPA|en|'));
  // General American first; Wiktionary also marks American lines as (non-)cot-caught
  const line = lines.find((l) => /\b(GA|US|GenAm)\b/.test(l)) || lines.find((l) => l.includes('cot-caught'))
    || lines.find((l) => !/\b(RP|UK|Cockney|AU|NZ|Scotland|Ireland|Irish|Yorkshire|Northumbria|Wales|India)\b/.test(l)) || lines[0];
  const m = line && line.match(/\{\{IPA\|en\|([^}]*)\}\}/);
  return m ? (m[1].split('|').find((x) => /^[/[]/.test(x)) || '') : '';
}

// Translation tables -> {languageCode: [{gloss, words}]}:
//   {{trans-top|to move through space}}
//   * Portuguese: {{t+|pt|ir}}, {{t+|pt|andar}}
//   *: Mandarin: {{t+|cmn|去}}
const TRANSLATION = /\{\{(?:tt?\+?|t\+?check)\|([a-z-]+)\|([^|}]+)/g;
function translationsFrom(text, out = {}) {
  let gloss = '';
  for (const line of text.split('\n')) {
    const top = line.match(/\{\{trans-top\|([^}]*)\}\}/);
    if (top) gloss = top[1].split('|').find((p) => !p.includes('=')) || '';
    if (!line.trimStart().startsWith('*')) continue;
    for (const m of line.matchAll(TRANSLATION)) {
      const word = m[2].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim();
      if (!word) continue;
      const list = (out[m[1]] ||= []);
      let sense = list.find((s) => s.gloss === gloss);
      if (!sense) {
        if (list.length >= 6) continue;
        sense = { gloss, words: [] };
        list.push(sense);
      }
      if (!sense.words.includes(word) && sense.words.length < 5) sense.words.push(word);
    }
  }
  return out;
}

// {ipa, tr} from the word's page. Very common words keep their main translations on a
// "word/translations" subpage, which comes first.
const wiktInfo = (word) => onDisk(`wiki:${word}`, async () => {
  const english = englishSection(await wiktPage(word));
  const tr = {};
  if (english.includes('{{see translation subpage')) translationsFrom(await wiktPage(`${word}/translations`), tr);
  translationsFrom(english, tr);
  return { ipa: ipaFrom(english), tr };
});

// "En-us-run.ogg" on Wikimedia Commons ('' if there's no recording)
const commonsAudio = (word) => onDisk(`audio:${word}`, async () => {
  const data = await politely('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', titles: `File:En-us-${word}.ogg`, prop: 'imageinfo', iiprop: 'url', format: 'json', formatversion: '2',
  }));
  const page = data && data.query && data.query.pages[0];
  return (page && !page.missing && page.imageinfo && page.imageinfo[0].url) || '';
});

const soft = (word, what) => (err) => { console.warn(`english ${what}:`, word, err.message); return null; };

// native = the learner's language (Wiktionary code: pt, es, cmn…) for translations. Japanese
// comes from JMdict instead, which also works offline.
async function entryFor(word, dict, native) {
  const defs = wordnet.definitions(word);
  const ja = japaneseFor(word, dict);
  const cmuIpa = cmudict.ipa(word);
  // Wiktionary only when it's needed: translations into another language, or IPA CMU lacks
  const needWiki = (native && native !== 'ja') || !cmuIpa;
  // AKKO_OFFLINE=1 skips the internet entirely (tests, or no connection)
  const online = !process.env.AKKO_OFFLINE;
  const [info, audioUrl] = await Promise.all([
    online && needWiki ? wiktInfo(word).catch(soft(word, 'translations')) : null,
    online ? commonsAudio(word).catch(soft(word, 'audio')) : '',
  ]);
  const tr = native === 'ja'
    ? ja.slice(0, 6).map((s) => ({ gloss: s.pos[0], words: [s.gloss[0]] }))
    : ((info && native && info.tr[native]) || []);
  const english = defs.map((d) => ({ pos: [d.pos], gloss: [d.text], misc: [], example: d.example }));
  if (!english.length && !tr.length && !known(word)) return null;
  return {
    word, reading: cmuIpa || (info && info.ipa) || '', forms: [], pitch: [], common: ja.some((s) => s.common),
    senses: english, tr, audio: audioUrl || '',
  };
}

// candidates = what the page sent (lemma, word as clicked); form = the word as clicked
async function lookup(candidates, form, dict, native) {
  buildVocab(dict);
  const words = [];
  for (const c of candidates) {
    const lower = c.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
    const parts = splitContraction(lower);
    const lemma = parts ? parts[0].lemma : lower.includes(' ') ? lower : lemmatize(lower).lemma;
    for (const w of [lemma, lower]) if (w && !words.includes(w)) words.push(w);
  }
  const entries = [];
  for (const w of words) {
    const e = await entryFor(w, dict, native);
    if (e) entries.push(e);
    if (entries.length === 2) break;
  }
  const f = form.toLowerCase().replace(/’/g, "'");
  const parts = splitContraction(f);
  const inflection = parts
    ? [`contraction (${parts.map((p) => p.lemma).join(' ')})`]
    : (lemmatize(f).lemma !== f ? lemmatize(f).tags.map((t) => LABELS[t]).filter(Boolean) : []);
  return { query: entries[0] ? entries[0].word : words[0] || '', entries, inflection: [...new Set(inflection)], kanji: [] };
}

// American pronunciation for Anki: {buf, ext, source}, or null when the word has no recording.
// Throws when Wikimedia couldn't be reached, so the failure isn't cached (server/audio.js).
async function audio(word) {
  const url = await commonsAudio(word.toLowerCase());
  if (!url) return null;
  return { buf: await fetchBuffer(url), ext: 'ogg', source: 'Wikimedia Commons' };
}

module.exports = { tokenize, lookup, audio };
