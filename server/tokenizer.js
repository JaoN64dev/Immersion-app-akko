// Splitting Japanese into morphemes: Lindera (WebAssembly, the IPADIC dictionary built in), with
// its tokens reshaped like kuromoji's, which akko used before and whose shape the rest of the code
// reads (server/dictionary.js, server/grammar.js, tools/check-lessons.js). Same dictionary, same
// parts of speech, about 65 MB less memory.
//
// A token: {surface_form, pos, pos_detail_1..3, conjugated_type, conjugated_form, basic_form,
// reading, pronunciation, word_type: "KNOWN" | "UNKNOWN", word_position (1-based)}.
// Words Lindera doesn't know come back as "UNK" with no part of speech; they get kuromoji's
// categories for unknown words by their kind of character (latin letters: a proper noun, digits:
// a number, spaces, symbols, kana or kanji: a noun).

const { TokenizerBuilder } = require('lindera-wasm-nodejs-ipadic');

function unknownPos(surface) {
  if (/^\s+$/.test(surface)) return ['記号', '空白', '*', '*'];
  if (/^[A-Za-zＡ-Ｚａ-ｚ]/.test(surface)) return ['名詞', '固有名詞', '組織', '*'];
  if (/^[0-9０-９]/.test(surface)) return ['名詞', '数', '*', '*'];
  if (/^[぀-ヿ㐀-鿿豈-﫿々〆ヵヶー]/.test(surface)) return ['名詞', '一般', '*', '*'];
  return ['名詞', 'サ変接続', '*', '*'];
}

function reshape(tokens) {
  let at = 1;
  return tokens.map((t) => {
    const surface = t.surface;
    const position = at;
    at += surface.length;
    if (t.partOfSpeech === 'UNK' || t.partOfSpeech === undefined) {
      const [pos, d1, d2, d3] = unknownPos(surface);
      return { surface_form: surface, pos, pos_detail_1: d1, pos_detail_2: d2, pos_detail_3: d3, conjugated_type: '*', conjugated_form: '*',
        basic_form: '*', reading: undefined, pronunciation: undefined, word_type: 'UNKNOWN', word_position: position };
    }
    return {
      surface_form: surface,
      pos: t.partOfSpeech,
      pos_detail_1: t.partOfSpeechSubcategory1,
      pos_detail_2: t.partOfSpeechSubcategory2,
      pos_detail_3: t.partOfSpeechSubcategory3,
      // Lindera's names for these two are the other way round from IPADIC's
      conjugated_type: t.conjugationForm,
      conjugated_form: t.conjugationType,
      basic_form: t.baseForm,
      reading: t.reading,
      pronunciation: t.pronunciation,
      word_type: 'KNOWN',
      word_position: position,
    };
  });
}

// Resolves to {tokenize(text) -> [token]} (a promise, like kuromoji's builder)
async function loadTokenizer() {
  const builder = new TokenizerBuilder();
  builder.setDictionary('embedded://ipadic');
  builder.setMode('normal');
  builder.setKeepWhitespace(true);
  const lindera = builder.build();
  return { tokenize: (text) => reshape(lindera.tokenize(String(text))) };
}

module.exports = { loadTokenizer };
