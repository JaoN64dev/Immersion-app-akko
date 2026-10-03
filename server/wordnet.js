// WordNet 3.1 (Princeton, npm "wordnet-db"): offline English definitions, and the lists of real
// nouns / verbs / adjectives / adverbs that server/english.js uses to find dictionary forms.
//
// The index files (word -> its senses, most common first) are read into memory the first time
// English is used (~1 s). The definitions stay in the data files, read at a sense's byte offset.

const fs = require('fs');
const path = require('path');
const { path: DICT } = require('wordnet-db');

const POS = { noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb' };

let db = null;    // {index: {noun: Map(word -> {offsets, tagged})…}, data: {noun: Buffer…}, sets}

function load() {
  if (db) return db;
  const started = Date.now();
  const index = {};
  const data = {};
  const sets = {};
  for (const pos of Object.keys(POS)) {
    index[pos] = new Map();
    sets[pos] = new Set();
    for (const line of fs.readFileSync(path.join(DICT, `index.${pos}`), 'utf8').split('\n')) {
      if (!line || line.startsWith(' ')) continue;          // the licence header lines start with spaces
      const f = line.trim().split(' ');
      // lemma pos synset_cnt p_cnt [ptr_symbol…] sense_cnt tagsense_cnt synset_offset…
      const pCnt = Number(f[3]);
      const tagged = Number(f[5 + pCnt]);
      const offsets = f.slice(6 + pCnt).map(Number);
      const word = f[0].replace(/_/g, ' ');
      index[pos].set(word, { offsets, tagged });
      sets[pos].add(word);
    }
    data[pos] = fs.readFileSync(path.join(DICT, `data.${pos}`));
  }
  db = { index, data, sets };
  console.log(`wordnet: ${[...Object.values(sets)].reduce((n, s) => n + s.size, 0)} words ready (${Date.now() - started} ms)`);
  return db;
}

// {noun: Set, verb: Set, adj: Set, adv: Set}
const sets = () => load().sets;

// how often the word was seen with that part of speech in WordNet's tagged texts (0 if never)
const frequency = (pos, word) => (load().index[pos].get(word) || { tagged: 0 }).tagged;

// One sense: the line at that byte offset, "… | definition; "example"; "example""
function sense(pos, offset) {
  const buf = load().data[pos];
  const end = buf.indexOf(10, offset);
  const line = buf.toString('utf8', offset, end < 0 ? undefined : end);
  const gloss = line.slice(line.indexOf('|') + 1).trim();
  const firstExample = gloss.indexOf('; "');
  const text = (firstExample < 0 ? gloss : gloss.slice(0, firstExample)).trim();
  const example = firstExample < 0 ? '' : (gloss.slice(firstExample).match(/"([^"]+)"/) || [])[1] || '';
  return { pos: POS[pos], text, example };
}

// [{pos, text, example}], the word's most common part of speech first, a few senses each
function definitions(word, max = 8) {
  const { index } = load();
  const key = word.toLowerCase();
  const found = Object.keys(POS).map((pos) => ({ pos, entry: index[pos].get(key) })).filter((x) => x.entry)
    .sort((a, b) => b.entry.tagged - a.entry.tagged || b.entry.offsets.length - a.entry.offsets.length);
  const out = [];
  for (const { pos, entry } of found) {
    for (const offset of entry.offsets.slice(0, found.length > 1 ? 3 : max)) out.push(sense(pos, offset));
  }
  return out.slice(0, max);
}

module.exports = { sets, frequency, definitions };
