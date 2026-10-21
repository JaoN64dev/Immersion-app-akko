// Expressions: idioms, set phrases and proverbs that are more than one word (首を長くする, 口を挟む,
// 猿も木から落ちる, 膝が笑う, 余計なお世話; in English give up, look forward, under the weather).
// The dictionaries have them, but text is split into words, so on its own the popup would explain
// 膝 "knee" and 笑う "laugh" in 膝が笑ってしまった. Here each expression is indexed by the
// dictionary forms of its words, as akko's own word splitting gives them, and a line's words are
// matched against that: conjugation comes for free (笑ってしまった is 笑う, 長くして is 長い + する).
//
// The words of a match get ex: <the expression's key> and et: its kind (server/dictionary.js for
// Japanese, server/english.js for English); the popup shows the expression first (scripts/popup.js).
// Kinds: "i" an idiom, proverb or four-character idiom (膝が笑う, 寝耳に水, 一石二鳥): its meaning
// isn't its words', so pages underline it; "p" an everyday set phrase (嘘をつく, 風邪をひく,
// 男の人): only shown in the popup, else one line in six would be underlined.
// Only neighbouring words match ("首を長くして" yes, "首をとても長くして" no). Where two
// expressions overlap, the longer one wins.

class ExpressionIndex {
  constructor() {
    this.byFirst = new Map();        // first word's dictionary form -> [{key, seq, kind}], longest first
    this.size = 0;
  }

  add(key, seq, kind = 'p') {
    if (!key || !Array.isArray(seq) || seq.length < 2) return;
    const list = this.byFirst.get(seq[0]);
    const item = { key, seq, kind };
    if (list) {
      // the same words twice (two spellings that split the same way): once is enough
      if (list.some((x) => x.key === key && x.seq.join('\t') === seq.join('\t'))) return;
      list.push(item);
    } else this.byFirst.set(seq[0], [item]);
    this.size++;
  }

  finish() {
    for (const list of this.byFirst.values()) list.sort((a, b) => b.seq.length - a.seq.length);
    return this;
  }

  // for the cache file: [[key, kind, word, word…], …]
  toList() {
    const out = [];
    for (const list of this.byFirst.values()) for (const { key, seq, kind } of list) out.push([key, kind, ...seq]);
    return out;
  }

  static fromList(list) {
    const index = new ExpressionIndex();
    for (const [key, kind, ...seq] of list) index.add(key, seq, kind);
    return index.finish();
  }

  // tokens: akko's tokens of one line ({s, b, …}). norm: how a token's b is compared (English:
  // lower case). skip: tokens that don't break a match (spaces between English words); any other
  // token without a dictionary form (punctuation) does.
  mark(tokens, { norm = (b) => b, skip = () => false } = {}) {
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      const candidates = t.b ? this.byFirst.get(norm(t.b)) : null;
      let end = 0, hit = null;
      if (candidates) {
        for (const c of candidates) {
          end = matchFrom(tokens, i, c.seq, norm, skip);
          if (end) { hit = c; break; }
        }
      }
      if (!hit) { i++; continue; }
      for (let k = i; k < end; k++) if (tokens[k].b) { tokens[k].ex = hit.key; tokens[k].et = hit.kind; }
      i = end;
    }
    return tokens;
  }
}

// where the expression starting at token i ends (exclusive), or 0
function matchFrom(tokens, i, seq, norm, skip) {
  let k = i;
  for (let j = 0; j < seq.length; j++) {
    if (j) while (k < tokens.length && skip(tokens[k])) k++;
    const t = tokens[k];
    if (!t || !t.b || norm(t.b) !== seq[j]) return 0;
    k++;
  }
  return k;
}

// Japanese grammatical nouns: an expression made only of these and particles is grammar, which
// the grammar lessons already mark (事がある, 様にする, 所に…)
const GRAMMATICAL = new Set(['事', '為', '様', '所', '物', '時', '中', '上', '方', '訳', '筈', '程', '内', '位', '頃', '度',
  '毎', '共', '等', '達', '処', '故', '儘', '通り', '迄', '丈', '許り', '乍ら', '分', '目', '的', '風', '気味', '次第']);
const hasKanji = (s) => /[一-鿿㐀-䶿々〆ヵヶ]/.test(s);

// Is this word sequence a real expression (not just grammar)? Japanese: at least one word with a
// kanji that isn't a grammatical noun.
const meaningfulJa = (seq) => seq.some((w) => hasKanji(w) && !GRAMMATICAL.has(w));

module.exports = { ExpressionIndex, meaningfulJa, hasKanji };
