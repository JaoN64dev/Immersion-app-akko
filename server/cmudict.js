// American pronunciation, offline: the CMU Pronouncing Dictionary (npm "cmu-pronouncing-dictionary",
// 134,000 words in ARPAbet), turned into IPA. Loaded the first time English is used.

const fs = require('fs');

// ARPAbet -> IPA (General American). AH and ER sound different when unstressed.
const IPA = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i',
  OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n',
  NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
const UNSTRESSED = { AH: 'ə', ER: 'ɚ' };
// consonant pairs that can start an English syllable (where the stress mark goes)
const ONSETS = new Set(['pl', 'pɹ', 'tɹ', 'kɹ', 'bl', 'bɹ', 'dɹ', 'fl', 'fɹ', 'ɡl', 'ɡɹ', 'kl', 'sp', 'st', 'sk', 'sl', 'sm', 'sn', 'sw', 'tw', 'kw', 'θɹ', 'ʃɹ', 'pj', 'kj', 'bj', 'fj', 'mj', 'hj']);

let dict = null;

function load() {
  if (dict) return dict;
  // the package is an ES module ("export const dictionary = {…}"); its body is plain JSON
  const src = fs.readFileSync(require.resolve('cmu-pronouncing-dictionary/index.js'), 'utf8');
  const start = src.indexOf('{', src.indexOf('dictionary ='));
  dict = JSON.parse(src.slice(start, src.lastIndexOf('}') + 1));
  return dict;
}

// "R AH1 N" -> "/ɹʌn/", "W AO1 T ER0" -> "/ˈwɔtɚ/"
function toIpa(arpabet) {
  const phones = arpabet.split(' ').map((p) => {
    const m = p.match(/^([A-Z]+)([012])?$/);
    const vowel = m[2] !== undefined;
    return { ipa: (m[2] === '0' && UNSTRESSED[m[1]]) || IPA[m[1]] || '', vowel, stress: m[2] };
  });
  const vowels = phones.filter((p) => p.vowel).length;
  const out = [];
  phones.forEach((p, i) => {
    if (p.vowel && vowels > 1 && (p.stress === '1' || p.stress === '2')) {
      // the mark goes before the syllable's first consonant(s)
      let at = out.length;
      const prev = phones[i - 1], prev2 = phones[i - 2];
      if (prev && !prev.vowel) {
        at -= 1;
        if (prev2 && !prev2.vowel && ONSETS.has(prev2.ipa + prev.ipa)) at -= 1;
      }
      out.splice(Math.max(at, 0), 0, p.stress === '1' ? 'ˈ' : 'ˌ');
    }
    out.push(p.ipa);
  });
  return `/${out.join('')}/`;
}

// IPA for a word or a phrase ("give up" -> /ɡɪv ʌp/), or '' if the dictionary doesn't have it
function ipa(word) {
  const parts = word.toLowerCase().split(/\s+/).map((w) => load()[w]);
  if (!parts.length || parts.some((a) => !a)) return '';
  return `/${parts.map((a) => toIpa(a).slice(1, -1)).join(' ')}/`;
}

module.exports = { ipa };
