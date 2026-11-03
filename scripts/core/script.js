// What writing system a text is in, and therefore which language's dictionary and word splitter it
// needs. This exists because of one real bug: a Japanese book imported while the target was German
// was filed as German, and the German splitter — spaces and punctuation — returned each line as a
// single "word", so the reader showed nothing clickable and the planner offered whole sentences as
// the words to learn first.
//
// A text is tokenized with the language it is actually written in, whatever the language being
// learnt or recorded, and a text whose script doesn't match the target is simply not in that
// target's library.

const SCRIPT_OF_LANGUAGE = {
    ja: "japanese", cmn: "han", yue: "han", ko: "hangul",
    ru: "cyrillic", uk: "cyrillic", el: "greek",
    ar: "arabic", fa: "arabic", he: "hebrew", hi: "devanagari", th: "thai",
};

const HAN_LANGUAGES = ["ja", "cmn", "yue"];

const TESTS = [
    ["japanese", /[\u3040-\u30ff]/],                       // kana: only Japanese writes them
    ["hangul", /[\uac00-\ud7a3\u1100-\u11ff]/],
    ["han", /\p{Script=Han}/u],
    ["cyrillic", /\p{Script=Cyrillic}/u],
    ["greek", /\p{Script=Greek}/u],
    ["arabic", /\p{Script=Arabic}/u],
    ["hebrew", /\p{Script=Hebrew}/u],
    ["devanagari", /\p{Script=Devanagari}/u],
    ["thai", /\p{Script=Thai}/u],
];

// The writing system a text is mostly in. Kana wins over Han (a Japanese sentence has both).
export function scriptOf(text) {
    const s = String(text || "");
    for (const [script, re] of TESTS) if (re.test(s)) return script;
    return "latin";
}

// The language of a text: the writing system decides, except where one script serves several
// languages akko knows (Latin, Cyrillic, Arabic, Han) — there the target is the best guess we have,
// so a French text read while learning German stays German's business rather than being "detected".
export function langOf(text, target = "ja") {
    const script = scriptOf(text);
    const targetScript = SCRIPT_OF_LANGUAGE[target] || "latin";
    if (script === targetScript) return target;
    // Han is shared: 我愛中文 is Chinese, but a kanji-only line while learning Japanese is Japanese
    if (script === "han" && HAN_LANGUAGES.includes(target)) return target;
    for (const [tag, own] of Object.entries(SCRIPT_OF_LANGUAGE)) if (own === script) return tag;
    return target;
}

// Does this text belong to the language being learnt? (what the library filters on)
export const belongsTo = (text, target) => langOf(text, target) === target;
