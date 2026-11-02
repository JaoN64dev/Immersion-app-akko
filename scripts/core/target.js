// The language you're learning. Saved in "akko-settings" as target; chosen on the welcome screen
// (scripts/site.js) and in Settings.
//
// Two are built in: ja (JMdict, furigana, grammar lessons, VOICEVOX) and en (WordNet, the CMU
// pronunciations). The rest are "dictionary-first": a Yomitan dictionary for the language
// (server/dictionaries.js) fills the popup, and the table below says how it tokenizes, which
// readings it has and which parts of akko apply. A tag that isn't in the table is accepted too,
// with a generic profile — a language nobody has looked at yet works as far as its dictionary
// does, which is the point of "any language".
//
// Each language keeps its own known words, lessons, course and progress. Japanese keeps the
// original storage names (so nothing saved before changes); every other language adds "-<tag>"
// (English has always used "-en"). Records in IndexedDB (texts, mined words) carry a lang field
// instead; old ones are Japanese.

import { store } from "./utils.js";

const SETTINGS = "akko-settings";

// A language that isn't built in: whitespace tokenizing, its dictionary comes from the user,
// the system's voices, no readings, no grammar lessons.
const first = (name, english, extra = {}) => ({
    name, english, tokenizer: "space", readings: "none", dictionary: "yomitan",
    lessons: false, voices: "os", handwriting: false, script: "latin", rtl: false, ...extra,
});

// tokenizer: cjk (no spaces: every word is looked up) · ko (spaces, particles stuck on)
//            space (whitespace and punctuation) · segment (Intl.Segmenter: Thai and friends)
// readings:  furigana · pinyin · romaja · ipa · none
// dictionary: jmdict · wordnet · yomitan (yours, from server/dictionaries.js)
// voices:    voicevox (Japanese only) · os (whatever the computer has)
export const LANGUAGES = {
    ja: {
        name: "日本語", english: "Japanese", tokenizer: "cjk", readings: "furigana",
        dictionary: "jmdict", lessons: true, voices: "voicevox", handwriting: true,
        script: "japanese", rtl: false,
    },
    en: {
        name: "English", english: "English", tokenizer: "space", readings: "ipa",
        dictionary: "wordnet", lessons: false, voices: "os", handwriting: false,
        script: "latin", rtl: false,
    },
    // dictionary-first
    cmn: first("中文", "Chinese", { tokenizer: "cjk", readings: "pinyin", script: "han", handwriting: true }),
    yue: first("粤語", "Cantonese", { tokenizer: "cjk", script: "han" }),
    ko: first("한국어", "Korean", { tokenizer: "ko", readings: "romaja", script: "hangul" }),
    de: first("Deutsch", "German"),
    es: first("Español", "Spanish"),
    it: first("Italiano", "Italian"),
    pt: first("Português", "Portuguese"),
    fr: first("Français", "French"),
    nl: first("Nederlands", "Dutch"),
    sv: first("Svenska", "Swedish"),
    da: first("Dansk", "Danish"),
    no: first("Norsk", "Norwegian"),
    fi: first("Suomi", "Finnish"),
    pl: first("Polski", "Polish"),
    cs: first("Čeština", "Czech"),
    ro: first("Română", "Romanian"),
    hu: first("Magyar", "Hungarian"),
    tr: first("Türkçe", "Turkish"),
    id: first("Bahasa Indonesia", "Indonesian"),
    vi: first("Tiếng Việt", "Vietnamese"),
    ru: first("Русский", "Russian", { script: "cyrillic" }),
    uk: first("Українська", "Ukrainian", { script: "cyrillic" }),
    el: first("Ελληνικά", "Greek", { script: "greek" }),
    hi: first("हिन्दी", "Hindi", { script: "devanagari" }),
    th: first("ไทย", "Thai", { tokenizer: "segment" }),
    ar: first("العربية", "Arabic", { script: "arabic", rtl: true }),
    fa: first("فارسی", "Persian", { script: "arabic", rtl: true }),
    he: first("עברית", "Hebrew", { script: "hebrew", rtl: true }),
};

// the order the pickers show them in: the two that come with akko, then the rest by name
export const LANGUAGE_CHOICES = [
    "ja", "en",
    ...Object.keys(LANGUAGES).filter((t) => t !== "ja" && t !== "en")
        .sort((a, b) => LANGUAGES[a].english.localeCompare(LANGUAGES[b].english)),
];

// LEARNABLE used to be {ja, en}: kept for anything that still reads it
export const LEARNABLE = Object.fromEntries(Object.entries(LANGUAGES).map(([tag, p]) => [tag, p.english]));

// a BCP-47-ish tag (de, cmn, ko, pt-BR) or one of the languages above
export const isKnown = (tag) => typeof tag === "string"
    && (/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(tag) || tag in LANGUAGES);

const saved = () => String(store.get(SETTINGS, {}).target || "").toLowerCase();

export const chosen = () => isKnown(saved());
export const target = () => (isKnown(saved()) ? saved() : "ja");
export const learningEnglish = () => target() === "en";

// what this language can do: tokenizer, readings, dictionary, lessons, voices, handwriting, rtl
export const profile = (tag = target()) => LANGUAGES[tag] || {
    name: tag.toUpperCase(), english: tag.toUpperCase(), generic: true,
    tokenizer: "space", readings: "none", dictionary: "yomitan", lessons: false,
    voices: "os", handwriting: false, script: "latin", rtl: false,
};

// a single capability of the language being learnt: has("lessons"), has("handwriting")…
export const has = (what) => !!profile()[what];

// label of the "% of words you know" badges
export const understood = () => (learningEnglish() ? "understood" : "理解");

// storage key for this language
export const keyFor = (name) => (target() === "ja" ? name : `${name}-${target()}`);

// does an IndexedDB record (text, mined word) belong to the language being learnt?
export const ofTarget = (rec) => (rec.lang || "ja") === target();

export function setTarget(lang) {
    const tag = String(lang || "").toLowerCase();
    if (!isKnown(tag)) return false;          // a bad value in the page can't wipe the choice
    store.set(SETTINGS, { ...store.get(SETTINGS, {}), target: tag });
    return true;
}

// the welcome screen each time akko opens (scripts/site.js): on unless turned off
export const welcomeOn = () => store.get(SETTINGS, {}).welcome !== false;
export function setWelcome(on) {
    store.set(SETTINGS, { ...store.get(SETTINGS, {}), welcome: !!on });
}

// ---------- your own language (translations of English words) ----------

// Wiktionary language codes -> names (Mandarin is "cmn" there)
export const NATIVE_LANGUAGES = {
    pt: "Português", es: "Español", fr: "Français", de: "Deutsch", it: "Italiano", ru: "Русский",
    uk: "Українська", pl: "Polski", nl: "Nederlands", sv: "Svenska", tr: "Türkçe", ar: "العربية",
    fa: "فارسی", hi: "हिन्दी", cmn: "中文", ja: "日本語", ko: "한국어", vi: "Tiếng Việt", th: "ไทย",
    id: "Bahasa Indonesia", tl: "Tagalog",
};

// saved choice, or the browser's language the first time ("" = no translations)
export function nativeLang() {
    const choice = store.get(SETTINGS, {}).native;
    if (choice !== undefined) return choice;
    const browser = (navigator.language || "").toLowerCase().split("-")[0];
    const code = browser === "zh" ? "cmn" : browser;
    return NATIVE_LANGUAGES[code] ? code : "";
}

export function setNative(code) {
    store.set(SETTINGS, { ...store.get(SETTINGS, {}), native: code });
}
