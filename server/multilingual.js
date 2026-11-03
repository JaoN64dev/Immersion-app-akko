// Dictionary-first languages: Korean, Chinese and everything akko has no parser for
// (scripts/core/target.js: tokenizer "ko", "cjk" without kana, "space").
//
// A line's words are the ones the dictionaries in Settings → Dictionaries know — longest match
// first — so this works the day a language is added and gets better with the dictionary you
// install. Korean also loses its particles (한국어를 -> 한국어) and gets a romanised reading, so the
// word you click is the word in the dictionary; Chinese takes its pinyin from the dictionary entry.
// Nothing here talks to the network: `words(lang)` is server/dictionaries.js.

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;
const HAN = /\p{Script=Han}/u;
const LETTER = /[\p{L}\p{N}]/u;

// ---------- readings: Revised Romanization of Korean ----------
//
// Good enough to be a hint over the word, not a textbook: the syllable tables are exact, and the
// changes between two syllables are the common ones (연음, 비음화, 유음화). Tensification and ㅎ
// aspiration are left out — RR often writes them the plain way anyway (학교 → hakgyo).

const LEAD = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// ㄱ ㄲ ㄳ ㄴ ㄵ ㄶ ㄷ ㄹ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅁ ㅂ ㅄ ㅅ ㅆ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ, sounded as a final
const TAIL_SOUND = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l',
    'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// …and as the first sound of the next syllable, when a vowel follows (연음: 한국어 → hangugeo)
const TAIL_ONSET = ['', 'g', 'kk', 'k', 'n', 'n', 'n', 'd', 'r', 'lg', 'rm', 'lb', 'ls', 'lt', 'lp', 'l',
    'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', ''];
const VOWEL_LEAD = 11;          // ㅇ: silent before a vowel, so the syllable before it lends its final

// (the final of one syllable, the first letter of the next) → how they are written
function link(tail, lead) {
    const sound = TAIL_SOUND[tail];
    const next = LEAD[lead];
    if (!sound) return ['', next];
    const nasal = lead === 2 || lead === 6;                     // ㄴ, ㅁ
    const liquid = lead === 5;                                  // ㄹ
    if (nasal && (sound === 'k' || sound === 't' || sound === 'p')) {
        return [sound === 'k' ? 'ng' : sound === 'p' ? 'm' : 'n', next];    // 국민 → gungmin, 합니다 → hamnida
    }
    if (liquid && sound === 'n') return ['l', 'l'];             // 신라 → silla
    if (liquid && sound === 'l') return ['l', 'l'];             // 실라 → silla
    if (liquid && sound === 'ng') return ['ng', 'n'];           // 강릉 → gangneung
    if (liquid && sound === 'k') return ['ng', 'n'];            // 독립 → dongnip
    if (liquid && (sound === 'p' || sound === 'm')) return ['m', 'n'];   // 심리 → simni, 밥류 → bamnyu
    if (liquid && sound === 't') return ['n', 'n'];             // 몇 리 → myeolli
    return [sound, next];
}

// 한국어 -> hangugeo. Anything that isn't Hangul is copied through (spaces, punctuation, 漢字).
function romanizeHangul(text) {
    let out = '';
    let syllables = [];
    const flush = () => {
        if (!syllables.length) return;
        let pending = 0;                                        // the final carried from before
        for (const s of syllables) {
            let lead = LEAD[s.lead];
            if (pending && s.lead === VOWEL_LEAD) {
                lead = TAIL_ONSET[pending];                     // the final becomes this syllable's first sound
                out += lead;
            } else {
                if (pending) {
                    const [tail, next] = link(pending, s.lead);
                    out += tail + next;
                } else out += lead;
            }
            out += VOWEL[s.vowel];
            pending = s.tail;
        }
        if (pending) out += TAIL_SOUND[pending];
        syllables = [];
    };
    for (const ch of String(text)) {
        const code = ch.charCodeAt(0) - 0xac00;
        if (code >= 0 && code < 11172) {
            syllables.push({ lead: Math.floor(code / 588), vowel: Math.floor((code % 588) / 28), tail: code % 28 });
        } else {
            flush();
            out += ch;
        }
    }
    flush();
    return out;
}

// ---------- splitting ----------

// Korean particles: the word in the dictionary is what's left when one comes off the end
const JOSA = ['에서', '에게', '한테', '으로', '까지', '부터', '보다', '처럼', '마다', '밖에', '이랑',
    '하고', '에는', '에도', '으로는', '이라는', '라는', '에서는',
    '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '로', '도', '만', '께', '랑', '서'];

const MAX_WORD = 12;            // the longest headword worth trying, in characters

const isHan = (ch) => HAN.test(ch);
const isWord = (ch) => LETTER.test(ch);
const isSpace = (ch) => /\s/.test(ch);

// Languages written without spaces between words, which ICU can still split (scripts/core/target.js
// says "segment" for these): Thai, Lao, Burmese, Khmer. Node ships with the dictionaries for them.
const SEGMENTED = new Set(['th', 'lo', 'my', 'km']);

// Hangul, Chinese, Thai and the space-separated majority each get their own way of finding words
function kindOf(lang) {
    if (lang === 'ko') return 'ko';
    if (lang === 'cmn' || lang === 'yue') return 'han';
    if (SEGMENTED.has(lang)) return 'segment';
    return 'space';
}

let segmenter = null;
let segmenterLang = null;
// Thai and friends: the word boundaries ICU knows, looked up like any other word
function splitSegmented(chunk, lang, words) {
    if (!segmenter || segmenterLang !== lang) {
        segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(lang, { granularity: 'word' }) : null;
        segmenterLang = lang;
    }
    if (!segmenter) return splitSpaced(chunk, words);          // no ICU for it: spaces are all we have
    const out = [];
    for (const part of segmenter.segment(chunk)) {
        if (part.isWordLike) {
            out.push(...splitSpaced(part.segment, words));
        } else if (out.length && /^[\p{M}\u200b\u200d]+$/u.test(part.segment)) {
            out[out.length - 1].s += part.segment;          // a vowel sign belongs to the word before it
        } else {
            out.push({ s: part.segment });                  // a space, punctuation, ฯ
        }
    }
    return out;
}

// A token: {s: the text as it appears, b: the dictionary word, f: [[text, reading]] for the ruby}
function word(s, base, reading) {
    const tok = { s, b: base };
    if (/\p{L}/u.test(s)) tok.c = 1;          // a number, 2024, isn't a word you learn
    if (reading) tok.f = [{ t: s, r: reading }];
    return tok;
}

// 한 국 어 를 -> [한국어][를]: try the whole chunk, then the word with a particle taken off
function splitKorean(chunk, words) {
    if (words.has(chunk)) return [word(chunk, chunk, romanizeHangul(chunk))];
    for (const josa of JOSA) {
        if (!chunk.endsWith(josa)) continue;
        const stem = chunk.slice(0, -josa.length);
        if (stem && words.has(stem)) return [word(chunk, stem, romanizeHangul(chunk))];
    }
    // a compound the dictionary only has in parts: the longest headword at the front, then the rest
    for (let len = Math.min(chunk.length, MAX_WORD); len >= 2; len--) {
        const head = chunk.slice(0, len);
        if (words.has(head)) return [{ ...word(head, head, romanizeHangul(head)) }, ...splitKorean(chunk.slice(len), words)];
    }
    return [word(chunk, chunk, romanizeHangul(chunk))];
}

// 我愛中文 -> [我][愛][中文]: forward longest match, one character when the dictionary has nothing
function splitHan(run, words) {
    const out = [];
    let i = 0;
    while (i < run.length) {
        let taken = 0;
        for (let len = Math.min(run.length - i, MAX_WORD); len >= 2; len--) {
            const candidate = run.slice(i, i + len);
            if (words.has(candidate)) { out.push(word(candidate, candidate, words.reading(candidate))); i += len; taken = 1; break; }
        }
        if (taken) continue;
        const ch = run[i];
        out.push(word(ch, ch, words.reading(ch)));       // an unknown character is still a word to click
        i++;
    }
    return out;
}

// Deutsch, Polski, Русский…: split on spaces, then let the dictionary take a suffix off
// (házban -> ház), so the word you save is the dictionary's
function splitSpaced(chunk, words) {
    if (words.has(chunk)) return [word(chunk, chunk, words.reading(chunk))];
    for (let len = chunk.length - 1; len >= 3; len--) {
        const stem = chunk.slice(0, len);
        if (words.has(stem)) return [word(chunk, stem, words.reading(stem))];
    }
    return [word(chunk, chunk, words.reading(chunk))];
}

function tokenizeLine(line, lang, words) {
    const kind = kindOf(lang);
    const out = [];
    let at = 0;
    while (at < line.length) {
        const rest = line.slice(at);
        const first = rest[0];
        if (!isWord(first)) {                                  // spaces, punctuation, ♪, ～ …
            let end = 0;
            while (end < rest.length && !isWord(rest[end])) end++;
            const run = rest.slice(0, end);
            for (const ch of run) out.push(isSpace(ch) ? { s: ch } : { s: ch });
            at += end;
            continue;
        }
        const han = isHan(first);
        let end = 0;
        while (end < rest.length) {
            const ch = rest[end];
            if (!isWord(ch)) break;
            if (kind === 'han' && isHan(ch) !== han) break;     // Han and かな/Latin don't mix in a word
            end++;
        }
        const run = rest.slice(0, end);
        if (kind === 'han' && han) out.push(...splitHan(run, words));
        else if (kind === 'ko' && HANGUL.test(run)) out.push(...splitKorean(run, words));
        else if (kind === 'segment') out.push(...splitSegmented(run, lang, words));
        else out.push(...splitSpaced(run, words));
        at += end;
    }
    return out;
}

function tokenize(text, lang, words) {
    const out = [];
    String(text).split('\n').forEach((line, i) => {
        if (i) out.push({ s: '\n' });
        out.push(...tokenizeLine(line, lang, words));
    });
    return out;
}

// Lines -> tokens, with the dictionaries for this language. `has` and `reading` are the only things
// this needs from them, so a test can pass its own ({has(){}, reading(){ return ''; }}).
function forLanguage(lang, dictionaries) {
    const words = dictionaries.words(lang);
    return { tokenize: (lines) => lines.map((l) => tokenize(String(l), lang, words)) };
}

module.exports = { tokenize, tokenizeLine, romanizeHangul, forLanguage, kindOf, JOSA };
