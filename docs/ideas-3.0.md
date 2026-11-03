# akko 3.0: the plan

Everything below ships in **one version**, `3.0.0`, built on a long-lived branch in phases. No phase
touches `main1` until the version is whole; each phase leaves akko working, so a `2.0.x` can be made
from `main1` at any time.

**The rule for this version: it has to run for free.** Work that costs CPU (speech recognition,
alignment, a language model, OCR, PDF) runs inside the app, on the user's machine. What's hosted is
static files on GitHub releases/Pages and the Cloudflare Worker that already exists (free tier). No
paid tier, no per-user cost — and no Apple Developer account, so macOS keeps opening the download page.

## The headline: any language

`scripts/core/target.js` no longer has a Japanese/English switch. It has a table, and a language that
isn't in the table still works:

```js
export const LANGUAGES = {
  ja: { name: "日本語", english: "Japanese", tokenizer: "cjk", readings: "furigana",
        dictionary: "jmdict", lessons: true, voices: "voicevox", handwriting: true, script: "japanese", rtl: false },
  en: { … dictionary: "wordnet", readings: "ipa" … },
  ko: …, cmn: …, de: …, es: …, it: …, pl: …, ru: …, ar: …, th: …,           // 29 so far
};
profile("sw")   // → a generic one: space tokenizing, your Yomitan dictionary, the system's voices
```

- **storage**: Japanese keeps `akko-words` (nothing saved before changes); every other language is
  `akko-words-<tag>`, so `-en` is exactly what it was.
- **dictionary**: `jmdict` and `wordnet` are built in; everything else is `yomitan` — the importer in
  `server/dictionaries.js` already takes Yomitan-format zips with a `language` field. That is the
  whole path to a new language.
- **capabilities**: `lessons`, `voices`, `handwriting`, `readings`, `rtl` are per language, so a page
  that doesn't apply to the language is hidden instead of broken.
- **readings**: furigana, pinyin, romaja, IPA — the same popup slot, a different source.

Honest limit: without grammar lessons for a language, "any language" means popup dictionary + mining
+ 復習 + listening from your own material. Everything else in akko still applies.

## The 20 features

| # | feature | size | hosted? |
|---|---|---|---|
| 1 | **Language table** (any tag, capabilities, storage per language) | L | none |
| 2 | Language picker everywhere (welcome, Settings, first run per language) | M | none |
| 3 | Korean, Chinese end to end: tokenizer, dictionary pack, readings | L | free: release assets |
| 4 | A dictionary pack per language (German, Polish, Russian, Spanish, Italian…) | M | free: release assets, R2 |
| 5 | Install-a-language packs (tokenizer hints, dictionary links, voices) | M | free: GitHub raw |
| 6 | Capability-based UI (no broken pages, no dead buttons) | S | none |
| 7 | **Coverage meter**: "% of words you know" before an episode or chapter | M | none |
| 8 | Priming sessions made from the next episode's subtitles | M | none |
| 9 | Local speech recognition (Whisper-class, in the app): subs for anything, auto line audio | L | free: model fetched once |
| 10 | Shadowing: record over the line, compare, per-syllable feedback | L | none |
| 11 | Handwriting and stroke order (KanjiVG), for ja and zh | M | free: bundled (CC BY-SA) |
| 12 | Anki two-way: `.apkg` with media and existing SRS | M | none |
| 13 | Card templates v2: trimmed audio, screenshot, pitch contour, frequency/JLPT badges | M | none |
| 14 | Study planner: "what now?", a time budget, heatmap | M | none |
| 15 | Stats 2.0: retention by source, coverage growth, time to the next level | M | none |
| 16 | Reader 2.0: EPUB/PDF/manga, read-aloud with the word highlighted, per-book words | L | none |
| 17 | Mine from anything: paste a URL, text or PDF page | M | none |
| 18 | Mobile parity as a PWA: installable, offline dictionary, swipe to grade | L | free: your own akko over the LAN |
| 19 | Cloud v2 + self-host: sync reviews and positions, share decks, Docker/WebDAV option | L | free: Worker free tier, or your machine |
| 20 | Opt-in local assistant: a grammar breakdown of the line you're stuck on | L | free: local model, or the user's own key |

## Phases

1. **Foundation** — 1, 6 (done: the table, `profile()`/`has()`, storage per language, tests).
2. **Languages** — 2, 3, 4, 5: picker driven by the table; Korean and Chinese end to end; a pack per
   language for the rest.
3. **A plan, not a pile** — 7, 8, 14, 15 (they share one coverage engine; build it in 7).
4. **Content without gaps** — 9, 17, 16, 13.
5. **Everything else** — 12, 10, 11, 18, 19, 20 (last: biggest, most opinionated).

## Constraints to respect

- **Licences**: CC-CEDICT (CC BY-SA), Wiktionary-derived dictionaries (CC BY-SA), KANJIDIC and
  KanjiVG (CC BY-SA), JMdict (CC BY-SA) — the attribution and share-alike notes go in *About*.
- **Size**: a GitHub release asset caps at 2 GB and the installer should stay lean, so models and big
  dictionaries are fetched on first use (R2 free tier: 10 GB).
- **Privacy stays the selling point**: recognition, the assistant and OCR run locally; nothing leaves
  the computer without an account, and then only what syncing needs.
- **Not free, so out of scope**: Apple Developer ID ($99/year). macOS keeps "open the download page".

## Status

- [x] `scripts/core/target.js`: the language table, generic profile, per-language storage, `has()`
- [x] `tests/languages.test.mjs`: ja/en unchanged, new languages, unknown tags, broken saved values
- [ ] the pickers (welcome, Settings) read the table
- [ ] Korean and Chinese end to end
- [ ] … the rest of the phases
- [x] step 2a: the pickers read the table — welcome screen (`scripts/site.js`) and Settings (`settings.html`, `scripts/pages/settings.js`) offer every language, with a line saying what the chosen one can do; `body.target-<tag>` drives `.ja-only` / `.en-only` (a third language gets the English UI and none of the Japanese), and the pages only Japanese has leave the menu — `pagesFor()` in the table.
- [x] step 2b: Korean and Chinese end to end, without a parser — `server/multilingual.js` finds a line's words in the dictionaries you installed (longest match first): Korean loses its particles (한국어를 → 한국어) and gets Revised-Romanisation readings over the word, Chinese gets its pinyin from the dictionary entry, every other language splits on spaces and lets the dictionary take a suffix off (házban → ház). `/api/tokenize` and `/api/dict` serve any language, Settings accepts a Yomitan dictionary for any language (it reads `sourceLanguage`), and sentences end on a full stop wherever that's how they end.
- [x] step 2c: dictionary packs — `server/packs.js` + Settings → Dictionaries shows one button per free pack for the language you learn: KRDICT (Korean, CC BY-SA 2.0 KR, 16 MB), CC-CEDICT (Mandarin, CC BY-SA 4.0, 8 MB), CC-Canto (Cantonese, CC BY-SA 3.0, 2 MB), downloaded from versioned GitHub releases and installed the way an upload is. German, Polish, Russian, Spanish and Italian have no verifiable free pack yet: the file picker is the way until one exists.
- [ ] step 2d: one-click packs for German, Polish, Russian, Spanish, Italian — need a versioned, licensed Yomitan release each (the Wiktionary converters publish per-language indexes but no zips yet).

**Phase 3 (started)**

- [x] step 3a: one coverage engine — `scripts/core/coverage.js` is now the only place a "% of this you know" number is worked out: the % and the words you don't (`coverage`, `comprehension`, `unknownIn`), the words worth learning first (`prime`, ranking a word that finishes a line above a word that just appears a lot) and what learning them would buy (`coverageIfKnown`). The video player, podcasts, the manga reader and the text reader all go through it; the reader shows it: **learn these first**, with the % it would take you to. Ignored words never count, a word still being learnt counts as unknown, an empty text is 0% and not NaN; 9 tests.
- [ ] step 3b: the planner — plan a week from what you have (texts, episodes, mails), by coverage and i+1 lines, instead of a flat "read more".
- [ ] step 3c: stats 2.0 — the same engine behind the numbers on Settings → stats (words known per day, coverage over time, the streak of lines you finished).
