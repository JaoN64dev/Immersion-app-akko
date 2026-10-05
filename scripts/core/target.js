// The language you're learning: "ja" (Japanese) or "en" (American English).
// Saved in "akko-settings" as target; chosen on the welcome screen (scripts/site.js) and in Settings.
//
// Each language keeps its own known words, lessons, course and progress. Japanese keeps the
// original storage names (so nothing saved before changes); English adds "-en" to them.
// Records in IndexedDB (texts, mined words) carry a lang field instead; old ones are Japanese.

import { store } from "./utils.js";

const SETTINGS = "akko-settings";

export const LEARNABLE = { ja: "Japanese", en: "English" };

export const chosen = () => !!LEARNABLE[store.get(SETTINGS, {}).target];
export const target = () => (store.get(SETTINGS, {}).target === "en" ? "en" : "ja");
export const learningEnglish = () => target() === "en";

// label of the "% of words you know" badges
export const understood = () => (learningEnglish() ? "understood" : "理解");

// storage key for this language
export const keyFor = (name) => (learningEnglish() ? `${name}-en` : name);

// does an IndexedDB record (text, mined word) belong to the language being learnt?
export const ofTarget = (rec) => (rec.lang || "ja") === target();

export function setTarget(lang) {
    store.set(SETTINGS, { ...store.get(SETTINGS, {}), target: lang });
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
    const saved = store.get(SETTINGS, {}).native;
    if (saved !== undefined) return saved;
    const browser = (navigator.language || "").toLowerCase().split("-")[0];
    const code = browser === "zh" ? "cmn" : browser;
    return NATIVE_LANGUAGES[code] ? code : "";
}

export function setNative(code) {
    store.set(SETTINGS, { ...store.get(SETTINGS, {}), native: code });
}
