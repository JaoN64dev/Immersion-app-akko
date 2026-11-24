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
- **Phase 4 is done**: speech recognition on the reader and the watch page, a webpage or a PDF into
  the reader, read-aloud with a per-book word list, card templates v2.
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
| 9 | Local speech recognition (Whisper-class, in the app) | L | done: tool, model download, reader + watch page |
| 10 | Shadowing: record over the line, compare | L | done (Watch page) |
| 11 | Handwriting and stroke order (KanjiVG), ja and zh | M | stroke order done (ja); handwriting not started |
| 12 | Anki two-way: `.apkg` with media and existing SRS | M | done: deck export, known words from an .apkg |
| 13 | Card templates v2: trimmed audio, screenshot, pitch, frequency | M | done (frequency, FreqSort, URL) |
| 14 | Study planner: "what now?", a time budget | M | done (planner + year heatmap) |
| 15 | Stats 2.0: coverage growth, i+1 lines, retention by source | M | done: bands, i+1 lines, retention by source, next level |
| 16 | Reader 2.0: EPUB/text/manga, read-aloud, per-book words | L | done |
| 17 | Mine from anything: a URL, text or PDF page | M | done |
| 18 | Mobile parity as a PWA | L | not started (the LAN page exists) |
| 19 | Cloud v2 + self-host: reviews, positions, shared decks | L | not started (2.0 sync exists) |
| 20 | Opt-in local assistant: a grammar breakdown of the line | L | done (🧠 explain, Ollama) |

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
   - [x] retention by source and "time to the next level" (`scripts/core/levels.js`, 6 tests): mined
     words now say where they came from (`kind`; older ones are recognised by what their page saved),
     and Stats shows, per source, reviews passed and how likely the words are remembered today (FSRS).
     A daily count of known words (`akko-known-days`) gives the pace of the last 30 days and the date
     of the next milestone (100 … 30,000) — after a week of history.
4. **Content without gaps** — 9, 17, 16, 13. **Next.**
   - [x] local ASR, the machine half: `server/asr.js` finds a Whisper-class tool that is already
     installed (whisper.cpp's `whisper-cli`, OpenAI's `whisper`, `faster-whisper`, or whatever
     `AKKO_WHISPER` points at), checks there is a model, and runs it to produce an SRT — the same shape
     the players already read. With nothing installed it says exactly what to install and that nothing
     is uploaded. `GET /api/asr` (status), `POST /api/asr/transcribe?lang=` (audio in, SRT out); 4
     tests, including a tool that writes nothing being an error and not an empty subtitle. The model
     comes with a one-click download: `POST /api/asr/model` fetches the pinned `ggml-base.bin`
     (~148 MB) from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`
     (pinned sha256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`) into
     `~/.cache/akko/whisper`; `AKKO_WHISPER_MODEL` remains the escape hatch and akko still ships no
     model.
   - [x] the ASR page half, for the reader: 読む → **🎙 subtitles from audio** sends the file, parses the
     SRT with the same parser the subtitle pages use, and lands the transcript in the library as a text
     (so it gets coverage, priming, mining and a place in the plan). Settings → **speech recognition**
     says what is installed here, or what to install.
   - [x] subtitles from audio where subtitles are loaded (the watch page): ffmpeg.wasm — already a
     dependency, used by dual-audio.js to switch audio tracks — extracts the video's audio to WAV and
     `POST /api/asr/transcribe` turns it into an SRT, loaded as subtitles the same way any .srt is
     (coverage, priming, mining, plan all apply). Remote URLs can't be read by ffmpeg.wasm, so this
     works for locally opened video files; ffmpeg.wasm runs in the browser, keeping with the "runs for
     free, nothing to install" rule.
   - [x] **the instructions are in the app**: Settings → speech recognition has *how to install it* —
     `brew install whisper-cpp`, the Windows zip and `PATH`, the Linux two lines, where the model goes
     (`~/.cache/akko/whisper`, the folder `server/asr.js` really reads), the two `pip` alternatives and
     `AKKO_WHISPER`/`AKKO_WHISPER_MODEL`. It opens by itself when there is nothing to use, 読む's failure
     now points at it, and the whole block is one `data-i18n` entry (ja, pt, es).
   - [x] model download with a pinned URL and a hash: `POST /api/asr/model` fetches the pinned
     `ggml-base.bin` (~148 MB) from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`
     (sha256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`) into `~/.cache/akko/whisper`,
     checked against the hash before use; `AKKO_WHISPER_MODEL` remains the escape hatch, akko still ships no model.
   - [x] mining from anything: 読む → **from a URL** fetches a webpage and extracts its readable
     text (scripts strip scripts, styles, nav, ads, and take the article/main content) into the same
     addText pipeline as pasted text — coverage, priming, mining, plan all apply. A PDF page still
     needs pdf.js (a new dependency) and is left for the next pass; anything that saves as .txt/.html
     works today.
   - [x] Reader 2.0: 読む → **🔊 read aloud** speaks the text with each word highlighted as it's said
     (browser speech synthesis, nothing uploaded), auto-scrolls to follow, and saves the words met to
     a per-book word list (`readWords` on the reading record).
   - [x] card templates v2: mined cards now carry `freq` (frequency rankings) and `url` (source page
     for web mining); Anki card templates can map fields to `frequency`, `url` alongside the existing
     `trimmed audio` (recordClip from cueStart→cueEnd), `screenshot` (grabFrame), `pitch` (pitchCardHtml),
     `pitchNotes`, `wordAudio` (JapanesePod101/Lingua Libre), and `spokenSentence` (VOICEVOX/TTS).
   - [x] **phase 4 fixes, after reading it all back**:
     - 読む → from a URL decodes the page in its own charset (Shift_JIS / EUC-JP: Aozora Bunko and
       older sites were mojibake), times out after 30 s, and stops downloading past 5 MB instead of
       after. The text comes out through the same extractor as an opened .html file, which drops
       furigana (`<rt>`) and counts a `<blockquote><p>` once; a page written as one `<div>` with
       `<br>`s (Aozora) is read whole instead of keeping only its title. `tests/reader-url.test.js`.
     - read aloud: Stop no longer leaves the run hanging (and the words met are saved when you stop);
       paragraphs not analysed yet are read instead of skipped; one utterance per sentence, since
       Chrome cuts long ones off; a voice is picked for the text's language (zh-CN for cmn, zh-HK for
       yue…) and a missing one is said instead of read in English; the page itself no longer scrolls
       with every word.
     - per-book words: under the text, the words of it you don't know yet by how often they come up,
       plus how many were met reading aloud, downloadable as a .tsv.
     - watch page → subtitles from audio is a real `<button>` (a `<label>` can't be disabled, so a
       double click ran two transcriptions), shows extraction %, uploads the WAV as `.wav`, and drops
       a result whose video was closed meanwhile.
     - whisper.cpp is only offered ggml `.bin` models: OpenAI whisper's `.pt` files share
       `~/.cache/whisper` and whisper-cli can't read them. `tests/asr-models.test.js`.
     - Anki: fields named Frequency / FreqSort / URL map themselves; `freqSort` gives the bare rank.
   - [x] **a PDF into the reader**: 読む → open a file takes `.pdf`. pdf.js (pinned 3.11.174, loaded on
     first use from jsDelivr like JSZip, with its CMaps so Japanese text comes out) reads the text layer
     in the browser; lines are glued back into sentences (`pdfLinesToParagraphs`, `tests/pdf.test.mjs`)
     and a font's radical look-alikes (⽣) become the kanji (生). A scanned PDF says it has no text.

5. **Everything else** — 12, 10, 11, 18, 19, 20 (biggest, most opinionated, last).
   - [x] **an Anki deck without AnkiConnect** (feature 12, the export half): Watch → mined words →
     **Anki deck (.apkg)**. sql.js (pinned 1.10.3, jsDelivr) writes the collection in the browser and
     JSZip packs it with the picture and line audio akko kept, and each word said by a speaker when
     there is one. Words reviewed in 復習 arrive with their interval and next review; the rest are new.
     Fixed ids for the note type ("akko"), the deck (`akko::Japanese` …) and every note (from the mined
     word) make a second export update instead of doubling. Checked against Anki's own importer (the
     `anki` Python package, 26.9.4): fields, media, schedule, no duplicates on re-import.
     `tests/apkg.test.mjs` covers the schedule and FreqSort.
   - [x] **known words from an Anki file** (feature 12, the import half): Watch → Anki panel → *or from
     an Anki file (.apkg)*. Reads both layouts — `collection.anki21`/`.anki2` and the zstd
     `collection.anki21b` of Anki 2.1.50+ (fzstd 0.1.1, jsDelivr), skipping the "please update" stub —
     finds each note type's word field by name, and applies the AnkiConnect import's rule (a mature
     card → known, else learning; known/ignored words never go down). Checked with files from Anki's
     own exporter in both layouts.
   - [x] **the local assistant** (feature 20): 🧠 explain in the word popup, on every page. First akko's
     own breakdown — each word with its dictionary form, reading and first meaning, and the grammar
     lessons in the sentence — then, when **Ollama** runs on this computer, a written explanation by a
     local model (`server/assistant.js`), streamed as it is written: a translation, word by word, the
     grammar, what's easy to miss, grounded with akko's own analysis in the prompt. Model output goes
     through the escaping Markdown renderer. Settings → *Local assistant* says what is installed, picks
     the model and says how to set it up (qwen2.5:7b, or :3b on a smaller computer). Nothing is sent
     anywhere; akko installs and ships nothing. `tests/assistant.test.js` uses a stand-in Ollama.
   - [x] **shadowing** (feature 10): Watch → 🎤 shadow or R replays the line while recording it, then
     records you for as long plus a second, and draws both melodies with a *melody match* %
     (`scripts/core/prosody.js`, pure): pitch by autocorrelation, each voice in semitones from its own
     median (a low and a high voice can match), slips dropped, then subsequence DTW — all of the line
     against any stretch of your recording at 2/3–1.5× its length, so an "eh" before or a word after
     doesn't count, with a small cost for stretching time. Tuned on real speech: the same sentence in
     another voice scores ~80–95, a different sentence ~25–70 (`tests/prosody.test.mjs` keeps the
     ranking, with the measured tracks in `tests/fixtures/`). Nothing is saved or sent.
   - [x] **watching from a magnet link** (not in the original 20; asked for): paste a `magnet:` link in
     the Watch page's link box. `server/torrent.js` runs it with WebTorrent 3.0.21 (TCP/UDP + DHT, where
     nyaa's peers are), downloads only the chosen episode in playback order, and serves it as
     `/api/torrent/<hash>/<file>/<name>` with Range requests, so the player, seeking, progress and
     "continue watching" treat it like any link. One torrent at a time, upload capped at 100 KB/s,
     stopped when the episode closes or nothing plays for 5 minutes; files stay in `<data>/torrents`
     (deletable from the bar) so whole-file features can use them. The bar says that it shares while it
     plays. `tests/torrent.test.mjs` seeds the sample locally and checks the list, exact byte ranges,
     stop and delete, offline. 10-bit x265 releases still need a browser that plays HEVC.
   - [x] **OpenAI whisper without ffmpeg**: the `whisper` command sends every input through ffmpeg and
     failed with `FileNotFoundError: [WinError 2]` where ffmpeg isn't installed (reported from a real
     session). A 16-bit PCM WAV now goes through `server/whisper-wav.py` instead (Python's `wave` module,
     the samples straight to the model; its code is passed with `python -c`, so it also works from
     inside the desktop app's app.asar). Any other file gets `needs-wav`, and 読む converts it to a WAV in
     the browser (`scripts/core/wav.js`) and sends it again. `tests/wav.test.mjs`.
   - [x] **your year** (feature 14, the heatmap): Settings → Stats → *Your year*, one square per day for
     the last 53 weeks, darker with more time (under 15 min / 30 / 60 / more), from the days
     `scripts/core/today.js` already keeps. A summary line says the same in words (active days, longest
     run, hours). `scripts/core/heatmap.js` is pure (`tests/heatmap.test.mjs`); colours come from the theme.
   - [x] **stroke order** (feature 11, first half): tap a kanji in the popup's 漢字 section and it
     draws itself stroke by stroke, numbered; tap again to replay. KanjiVG (pinned r20250816, jsDelivr,
     CC BY-SA 3.0, credited on the pages and in the README), fetched per kanji and kept for the
     session; only path data and number positions are read from the file (`scripts/words/strokes.js`).
     Handwriting input and Chinese stroke order are still open.

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

**The rest of the gap, measured.** `npm run i18n-audit` lists every English text node on a page that
has no key in the three tables. It is 117 today (3+ words; `--all` counts the brand names too), mostly
long paragraphs in `settings.html` (30), `listening.html` (14), `index.html` (11), `about.html`,
`review.html` and `grammar.html` (10 each). Two causes, and they need different fixes:

- a paragraph split by `<b>`/`<a>` is several text nodes, so no key can ever match it — the fix is
  `data-i18n="…"` on the paragraph and one `html` key, as `about.html` now does for *who* and
  *what's new*;
- a plain paragraph just needs a key.

Do it page by page, starting with `settings.html` (the page you open to fix things) and `index.html`
(the first screen), and keep `npm run i18n-audit` going down: it exits 0 always, it is a map, not a test.

**Ten interface languages.** English, 日本語, Português and Español are complete; **Deutsch, Français,
Italiano, Русский, 中文 and 한국어** joined them with the chrome — navigation, every button, the
settings sections, Review's four answers, the plan — 147 entries each. A table that is smaller than the
English is fine: whatever it lacks stays English (`lookup()` returns nothing and the page is left alone),
so a language can be filled in over time instead of waiting for 824 strings. `npm run i18n-audit --
--lang de` lists what that language is still missing, and `tests/i18n.test.mjs` fails if a table has a
key English doesn't (a typo, a translation nobody would ever see), an empty translation, a lost `{n}`,
or is missing the menu itself. The picker is built from `LANGUAGES` in `scripts/i18n.js`, so a new
language appears there by itself once its file is imported.

The next pass on each of the six: the long paragraphs in `settings.html` and `listening.html` (they need
`data-i18n` blocks, see the paragraph above), then `index.html` and `review.html`.

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
