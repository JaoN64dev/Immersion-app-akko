# akko 3.0: the plan

Everything here ships in **one version**, `3.0.0`, built on a long-lived branch in phases. No phase
touches `main1` until the version is whole; each phase leaves akko working, so a `2.0.x` can be cut
from `main1` at any time.

**The rule for this version: it has to run for free.** Work that costs CPU (speech recognition,
alignment, a language model, OCR, PDF) runs inside the app, on the user's machine. What's hosted is
static files on GitHub releases/Pages and the Cloudflare Worker that already exists (free tier). No
paid tier, no per-user cost — and no Apple Developer account, so macOS keeps opening the download page.

## Where it stands

- **Phase 1, 2 and 3 are done** (see the checklists below): any language in the table works through
  its own dictionary, the app plans your week from what you have, and the numbers come from one place.
- **Phase 4 is under way**: speech recognition is in (a Whisper-class tool on your own machine, and
  読む → subtitles from audio); mining from anything, Reader 2.0 and card templates are next.
- Phase 5 (`.apkg`, shadowing, handwriting, PWA, cloud v2, the local assistant) is untouched.

## The headline: any language

`scripts/core/target.js` is not a Japanese/English switch any more:

```js
export const LANGUAGES = {
  ja: { name: "日本語", english: "Japanese", tokenizer: "cjk", readings: "furigana",
        dictionary: "jmdict", lessons: true, voices: "voicevox", handwriting: true, script: "japanese", rtl: false },
  en: { … dictionary: "wordnet", readings: "ipa" … },
  ko: …, cmn: …, de: …, es: …, it: …, pl: …, ru: …, ar: …, th: …,           // 29 so far
};
profile("sw")   // → the generic one: space tokenizing, your Yomitan dictionary, the system's voices
```

- **storage**: Japanese keeps `akko-words` (nothing saved before changes); every other language is
  `akko-words-<tag>`, so `-en` is exactly what it was, and videos/podcasts/manga keep their own
  per-language progress.
- **dictionary**: `jmdict` and `wordnet` are built in; everything else is `yomitan` — the importer in
  `server/dictionaries.js` takes Yomitan-format zips for any language and believes the
  `sourceLanguage` its `index.json` declares.
- **capabilities**: `lessons`, `voices`, `handwriting`, `readings`, `rtl`, and `pagesFor()` — which
  pages a language has. The menu loses the pages a language doesn't have instead of showing dead ends.
- **readings**: furigana, pinyin, romaja, IPA — the same ruby slot, a different source.
- **words without a parser**: `server/multilingual.js` finds them in the dictionaries you installed.
  Longest match first (Chinese/Japanese-Kanji runs), Korean particles stripped so the word you save is
  the dictionary one (한국어를 → 한국어), Revised Romanisation over Korean, the dictionary's pinyin over
  Chinese, a suffix taken off a spaced language when the stem is a headword (házban → ház), and ICU's
  word boundaries for Thai and friends.
- **one-click packs** (`server/packs.js`): KRDICT for Korean, CC-CEDICT for Mandarin, CC-Canto for
  Cantonese, from versioned GitHub releases, installed exactly like an upload. Nothing is fetched
  unless you click.

Honest limits: without grammar lessons for a language, "any language" means popup dictionary + mining
+ 復習 + listening + the reader and the planner. German, Polish, Russian, Spanish and Italian have no
verifiable free pack yet, so they work through *Settings → Dictionaries → add a .zip*.

## The 20 features

| # | feature | size | state |
|---|---|---|---|
| 1 | **Language table** (any tag, capabilities, storage per language) | L | done |
| 2 | Language picker everywhere (welcome, Settings, per language) | M | done |
| 3 | Korean, Chinese end to end: words, dictionary, readings | L | done |
| 4 | A dictionary pack per language | M | ko/cmn/yue done; de/pl/ru/es/it need a licensed release |
| 5 | Install-a-language bundles (tokenizer hints, dictionary, voices) | M | partly: any language is installable, bundles are not |
| 6 | Capability-based UI (no broken pages, no dead buttons) | S | done |
| 7 | **Coverage meter**: "% you know" before an episode or chapter | M | done |
| 8 | Priming sessions made from what's next | M | done (reader + plan) |
| 9 | Local speech recognition (Whisper-class, in the app) | L | partly: tool, SRT, reader button |
| 10 | Shadowing: record over the line, compare | L | not started |
| 11 | Handwriting and stroke order (KanjiVG), ja and zh | M | not started |
| 12 | Anki two-way: `.apkg` with media and existing SRS | M | not started |
| 13 | Card templates v2: trimmed audio, screenshot, pitch, frequency | M | not started |
| 14 | Study planner: "what now?", a time budget | M | done (planner); heatmap left |
| 15 | Stats 2.0: coverage growth, i+1 lines, retention by source | M | partly: bands, average, i+1 lines |
| 16 | Reader 2.0: EPUB/text/manga, read-aloud, per-book words | L | partly: EPUB import and the reader exist from 2.0 |
| 17 | Mine from anything: a URL, text or PDF page | M | partly: pasted text only |
| 18 | Mobile parity as a PWA | L | not started (the LAN page exists) |
| 19 | Cloud v2 + self-host: reviews, positions, shared decks | L | not started (2.0 sync exists) |
| 20 | Opt-in local assistant: a grammar breakdown of the line | L | not started |

## Phases

1. **Foundation** — 1, 6.
   - [x] the table, `profile()` / `has()` / `pagesFor()`, storage per language, `setTarget` that can't
     be broken by a stray value, tests (`tests/languages.test.mjs`).
2. **Languages** — 2, 3, 4, 5.
   - [x] the welcome screen and Settings read the table (two cards + "or another language"), and a line
     says what the chosen language can actually do.
   - [x] `server/multilingual.js`: longest match, Korean particles + romanisation, pinyin,
     suffix stripping, ICU segmentation for Thai; `/api/tokenize` and `/api/dict` serve any language;
     a full stop ends a sentence wherever that is how sentences end.
   - [x] packs for Korean, Mandarin and Cantonese; any language accepted by the uploader.
   - [x] a language only shows the pages it has; `.ja-only` / `.en-only` settle into their real
     meaning (Japanese content, everything else).
   - [ ] a licensed, versioned pack for German, Polish, Russian, Spanish, Italian — the Wiktionary
     converters publish per-language indexes but no zips, so this waits for a real release.
3. **A plan, not a pile** — 7, 8, 14, 15, one engine.
   - [x] `scripts/core/coverage.js`: totals, %, the unknown words with their counts, i+1 lines, the
     words worth learning first (`prime`), and what learning them would buy (`coverageIfKnown`).
     Every page's % goes through it (player, podcasts, manga, text reader). Ignored words never count,
     "learning" counts as unknown, an empty text is 0% and not NaN. 9 tests.
   - [x] the reader shows **learn these first**, with the % it would take you to.
   - [x] `scripts/core/planner.js` (pure, 10 tests): a week of ~25-minute sessions, the 85–94% band
     first, started before unstarted, nothing twice, leftovers kept; videos, podcasts and manga join
     as items that arrive with their own %, needing no tokenizing.
   - [x] Settings → Stats: **what you can read now** (texts banded by coverage, with the average) and
     **lines one word away**.
   - [ ] coverage of the library *before* you open it is only known once the planner has run; the
     EPUB/file list could carry it from the start.
   - [ ] retention by source and "time to the next level".
4. **Content without gaps** — 9, 17, 16, 13. **Next.**
   - [x] local ASR, the machine half: `server/asr.js` finds a Whisper-class tool that is already
     installed (whisper.cpp's `whisper-cli`, OpenAI's `whisper`, `faster-whisper`, or whatever
     `AKKO_WHISPER` points at), checks there is a model, and runs it to produce an SRT — the same shape
     the players already read. With nothing installed it says exactly what to install and that nothing
     is uploaded. `GET /api/asr` (status), `POST /api/asr/transcribe?lang=` (audio in, SRT out); 4
     tests, including a tool that writes nothing being an error and not an empty subtitle. No
     auto-download of a model yet: that is the next decision (a URL that stays put, and a hash).
   - [x] the ASR page half, for the reader: 読む → **🎙 subtitles from audio** sends the file, parses the
     SRT with the same parser the subtitle pages use, and lands the transcript in the library as a text
     (so it gets coverage, priming, mining and a place in the plan). Settings → **speech recognition**
     says what is installed here, or what to install. A video file is refused on purpose: Whisper wants
     audio, and pulling audio out of a video needs ffmpeg — that is the next decision.
   - [ ] subtitles from audio where subtitles are loaded (the watch page), which needs that ffmpeg step
     or an audio track the user already has.
   - [ ] model download with a pinned URL and a hash, so "nothing installed" is one click away from
     "working" without akko shipping a model.
   - [ ] mining from anything (URL, PDF page) into the reader, then the same text pipeline.
   - [ ] Reader 2.0: read-aloud with the word highlighted, per-book word lists.
   - [ ] card templates v2.
5. **Everything else** — 12, 10, 11, 18, 19, 20 (biggest, most opinionated, last).

## Fixes after the first local test (3.0.1)

Reported from a real session, all fixed on the branch that follows the merge:

- **The plan box was unreadable in the dark theme.** The new CSS carried five literal colours
  (`#fbf7ec`, `#f4e9c8`, `#7a6a3d`…) while the text inside inherits the theme's light `--on-panel`:
  cream on cream, invisible. Every 3.0 panel now takes its colours from the theme variables
  (`--post-bg`, `--ink`, `--ink-soft`, `--table-highlight`), and `tests/theme.test.js` fails if a
  literal colour comes back to those selectors.
- **The new interface text was English only.** Every 3.0 string — the plan, the priming chips, the
  bands in Stats, the language note, the speech recognition section — is now a key in
  `scripts/lang/{ja,pt,es}.js`, written as whole sentences with `{n}`/`{lang}`/`{tool}` placeholders so
  the interface's own language applies. The ASR status comes back from the server as a *code*
  (`missing` / `model` / `ready`) and the page words it, instead of the server writing English.
- **"learn these first" offered whole sentences as words.** A Japanese book pasted during a German
  session was filed as German and split by the space splitter, so each line came back as one word.
  `scripts/core/script.js` reads the writing system, files a text under the language it is *written
  in*, migrates texts that were filed wrongly, and every text is tokenized with its own language
  (`tokenize(lines, lang)`), never the target's. Near-empty texts (a stray "AAA OI OI") are kept out
  of the plan.
- **A language with no dictionary now says so** in Settings → Learning, next to the picker, instead of
  opening a popup with nothing in it.

**"Muitos idiomas não têm dicionário" now has a way through that is not a pack.**
Settings → Dictionary → *add from a link*: paste the address of any Yomitan `.zip` for the language you
are learning, and the server — on your machine — downloads it, checks it really is a Yomitan
dictionary, and installs it (`POST /api/dictionary/from-url`). Only http(s), a size ceiling, and the
community list linked right there. That covers every language today; nothing is hosted by us and
nothing is uploaded anywhere. Packs stay worth making for the ones people pick most (German first),
but no language needs one to work.

Still open from that session: **more interface languages** (en/ja/pt/es today; a new one is a file +
an entry in the picker, but it needs a real translation, so pt-BR gets reviewed first).

## Constraints to respect

- **Licences**: CC-CEDICT and CC-Canto (CC BY-SA), KRDICT (CC BY-SA 2.0 KR), Wiktionary-derived
  dictionaries (CC BY-SA), KANJIDIC and KanjiVG (CC BY-SA), JMdict (CC BY-SA). Attribution and the
  share-alike note go in *About*, and `server/packs.js` carries each pack's licence and its author.
- **Size**: a GitHub release asset caps at 2 GB and the installer should stay lean, so models and big
  dictionaries are fetched on first use (R2 free tier: 10 GB).
- **Privacy stays the selling point**: recognition, the assistant and OCR run locally; nothing leaves
  the computer without an account, and then only what syncing needs. The app's only unprompted network
  call stays the once-a-day update check.
- **Free hosting only**: no service in any phase needs a paid tier to work for the first user or the
  thousandth.
