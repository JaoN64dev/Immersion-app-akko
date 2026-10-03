# How akko works

This explains the code behind the app: how the pieces fit, where each feature lives, how data moves and where it's saved. It's for anyone changing the code. To *use* the app, see the main [README](../README.md); to write lessons, see [grammar/README.md](../grammar/README.md) and [course/README.md](../course/README.md).

## The big picture

akko is two programs that run on your own computer:

- **A small server** (Node.js + Express, `server.js` and `server/`). It serves the pages, and does what a browser can't do alone: split Japanese and English into words, look words up in big offline dictionaries, fetch subtitle sites and podcast feeds (browsers block most of those), talk to Anki, run manga OCR.
- **The pages** (`*.html`, `style.css`, `scripts/`). Plain HTML and JavaScript modules, no framework and no build step. Everything you do (known words, progress, mined words, books) is saved **in the browser**, not on the server.

```
 browser (pages + scripts/)                        server (server.js + server/)
 ─────────────────────────                         ────────────────────────────
 Watch / Read / Listen ── lines of text ─────────▶ /api/tokenize ─▶ words + grammar marks
     │   click a word ──── word ─────────────────▶ /api/dict     ─▶ dictionary entry
     │   + mine ────────── card ─────────────────▶ /api/anki     ─▶ AnkiConnect (Anki app)
     ▼                                             /api/subs, /api/opensubs ─▶ subtitle sites
 localStorage + IndexedDB                          /api/podcasts ─▶ RSS feeds, transcripts
 (words, progress, books, mined words)             /api/grammar, /api/course ─▶ grammar/*.md …
```

Start the server with `npm start` (or `start-akko.bat` on Windows, which also opens the browser). It listens on `http://127.0.0.1:3000`, only reachable from your own computer.

The **desktop app** (`electron/main.js`, built with `npm run dist`) is the same thing in a window. It sets `AKKO_DATA` to a folder in the user profile, copies the bundled dictionary files there on the first start, calls `start(3417)` from `server.js`, and opens a window on that address. The port never changes, because the window's storage (words, books…) belongs to the address. Links to other sites open in the normal browser. On each start it asks (a native dialog, before the server starts) whether to open the **app window** or the **browser**, unless `--browser` / `--window` is given or a choice was remembered (`desktop.json` in the user profile; the akko menu → When akko starts). In **browser mode** no window opens: the app shows a tray icon, keeps the server running and opens the address in the default browser. `npm run desktop` runs it from the code (through `electron/run.js`, which removes `ELECTRON_RUN_AS_NODE`: VS Code terminals set it, and it stops Electron from opening a window).

## Folders

| Folder / file | What's in it |
|---|---|
| `server.js` | Starts Express, mounts the API routes, serves the pages and static folders. `start(port)` is exported for the desktop app |
| `electron/` | The desktop app: `main.js` (window + server), `run.js` (`npm run desktop`), icons |
| `server/` | One module per API (dictionary, English, grammar, subtitles…), see below |
| `*.html` | One file per page: `index.html` (Watch), `reading.html`, `podcasts.html`, `grammar.html`, `course.html`, `review.html`, `settings.html`, `about.html` |
| `scripts/pages/` | The entry script of each page (`watch.js`, `read.js`, `listen.js`, `grammar.js`, `course.js`, `review.js`, `settings.js`, `stats.js`) |
| `scripts/` (other folders) | Shared browser code, grouped by feature (`words/`, `player/`, `reader/`, `podcasts/`, `anki/`, `grammar/`, `core/`) |
| `scripts/lang/ja.js` | The Japanese translation of the interface |
| `grammar/`, `grammar-en/` | Grammar lessons as Markdown, Japanese and English |
| `course/`, `course-en/` | Course steps as Markdown; `course-en/pt`, `/es`, `/ja` are translations |
| `data/` | Dictionary files (`dict.json`, `kanji.json`, `accents.txt`), and things the server saves: `ocr/`, `english-online.json`, `opensubtitles.json` |
| `tools/` | `check-lessons.js` (`npm run check-lessons`) |
| `tests/` | automated tests (`npm test`) |
| `docs/` | this page, and [native-review.md](native-review.md) (what a native speaker should check) |
| `images/`, `fonts/` | Static files |

## Two languages to learn, two interface languages

These are separate settings, both stored in localStorage `akko-settings`:

- **`target`**: what you're learning, `ja` or `en`. Chosen on the first visit (`scripts/site.js` shows the chooser), changeable in Settings. `scripts/core/target.js` has the helpers.
- **`lang`**: the interface language, English (default) or 日本語 (`scripts/i18n.js`).
- **`native`**: your own language, used for translations of English words (a Wiktionary code like `pt`, `es`, `cmn`).

### How the target language changes things

- **`body.target-ja` / `body.target-en`** is set by `site.js` on every page. Anything with `class="ja-only"` or `class="en-only"` is hidden in the other mode by CSS. That's how the Watch page swaps the kitsunekko search for the OpenSubtitles search, and how manga disappears in English mode.
- **The English theme is blue**: `body.target-en` redefines the colour variables in `style.css`.
- **Every request that depends on the language carries it**: `/api/tokenize {lang}`, `/api/dict?lang=`, `/api/grammar?lang=`, `/api/course?lang=&native=`.
- **Each language keeps its own saved data.** `keyFor(name)` returns the localStorage key: Japanese keeps the original names (`akko-words`), English adds `-en` (`akko-words-en`). Records in IndexedDB (books, mined words) carry a `lang` field instead, and `ofTarget(record)` filters them. Old records with no `lang` count as Japanese.

### How the interface translation works

The pages are written in English. `scripts/i18n.js` swaps text for its Japanese version from `scripts/lang/ja.js`. It walks the page's text nodes and the `title` / `placeholder` / `aria-label` attributes, and a `MutationObserver` translates text that scripts add later (toasts, statuses, the popup).

- Entries can have placeholders: `"{n} unknown words": "未知の単語 {n} 個"`.
- Anything inside an element with its own `lang="…"` or with `translate="no"` is left alone. That's what keeps subtitles, books, dictionary meanings and lesson text from being "translated".
- Paragraphs with links inside use `data-i18n="key"` and a whole-HTML entry in `ja.js`.
- For `confirm()` boxes, scripts call `t("…")`.

## Splitting text into words: `/api/tokenize`

Every page that shows text (subtitles, books, transcripts, examples) sends its lines to `POST /api/tokenize {lines, lang}` and gets back, per line, a list of tokens:

```js
{ s: "食べている", b: "食べる", f: [{t: "食", r: "た"}, {t: "べている"}], c: 1, gr: ["te-iru"] }
//  s = the text   b = dictionary form   f = furigana   c = counts as a word   n = a name   gr = grammar lessons
```

`scripts/words/render.js` turns tokens into clickable `<span class="w" data-b="…">` elements (`tokensHtml`), works out the "% understood" (`comprehension`), and finds the sentence around a word (`sentenceAround`).

### Japanese (`server/dictionary.js`)

1. **kuromoji** splits the line into morphemes (食べ / て / いる).
2. `groupTokens` glues them back into the words a learner looks up: verbs with their endings (食べている), する-nouns (勉強する), names with さん.
3. `lemmaOf` picks the dictionary form that exists in JMdict.
4. `furigana` lines the reading up with the kanji.
5. Particles, names and numbers don't count towards "% understood" (`c` isn't set).
6. Grammar detection marks the words (see below).

### English (`server/english.js`)

1. A regular expression finds the words. Contractions are split into pieces: *don't* becomes *do* + *n't*, *I'm* becomes *i* + *'m*.
2. `lemmatize` finds each word's dictionary form:
   - an **irregular table** first (went → go, children → child, better → good),
   - then **suffix rules** (-ing, -ed, -s, -er/-est) whose result must be a real word in **WordNet**'s lists of nouns, verbs and adjectives,
   - **WordNet's frequency counts** decide unclear cases: *evening* stays a noun, *running* becomes *run*,
   - **context:** after *the/a/my* an -ing word that is also a noun stays a noun (*the meeting*), and after *the/to/can* an irregular verb form that is also a word stays itself (*the ground*, *to lay*).
3. Each piece gets **tags** that grammar rules can use: `ing`, `past`, `pp`, `s`, `er`, `est`, `base`, `verb`, `noun`, `adj`, `adv`, `modal`, `pronoun`, `wh`, `article`.
4. Grammar words (articles, pronouns, prepositions, auxiliaries) are clickable but don't count towards "% understood", like Japanese particles.

## Grammar detection

Lessons (`grammar/*.md`, `grammar-en/*.md`) are read by `server/grammar.js`, through `server/mdfolder.js`. That module re-reads a folder whenever a file in it changes, so edits show up without a restart. Each lesson's `detect:` lines become rules: a list of steps, each a set of alternatives (`て|で + いる[非自立]`).

`detect(tokens, lang)` slides every rule along the line's tokens (kuromoji's morphemes for Japanese, the word pieces for English). `matchAt` checks one starting position.

- A normal step must match the current token, by its text, its dictionary form, or its part of speech / tag.
- A step starting with `!` takes no token: it fails if the token *before* the next step matches. That's how "present perfect, but not after *would*" is written.

The matches come back as token ranges. The tokenizer maps them onto the words it returns as `gr: [lesson ids]`. The page draws those words with a purple dotted underline, and the popup lists the lessons.

**English lessons in other languages:** `grammar-en/<code>/<lesson>.md` gives a lesson's title, meaning, explanation and example translations in the learner's language (Settings → Your language). `server/grammar.js` merges it over the English lesson (`lessons(lang, native)`); level, order, rules and the English examples always come from the English file. The course works the same way with `course-en/<code>/`.

**`npm run check-lessons`** (`tools/check-lessons.js`) checks every lesson file, every translation, and that each lesson's rules still find the grammar in all of its own examples. Run it after editing lessons.

## Looking words up: `/api/dict` and the popup

`scripts/popup.js` handles clicks on words (or a drag-selection) in any area a page registers with `enableWordClicks(container, lineSelector, contextFor)`. It calls `GET /api/dict?q=<dictionary form>&q=<as clicked>&form=<as clicked>&lang=&native=`.

**Japanese** (`server/dictionary.js`) answers from offline data loaded at start:

| What | Source |
|---|---|
| Meanings | JMdict (`data/dict.json`) |
| Kanji info | KANJIDIC2 (`data/kanji.json`) |
| Pitch accent | Kanjium (`data/accents.txt`) |
| What the ending means (食べ**られなかった** → passive + negative + past) | `explainForm` |
| Before JMdict is ready, on the very first start | jisho.org |

**English** (`server/english.js` → `entryFor`):

- **Offline:**
  - definitions from **WordNet** (`server/wordnet.js`; the index is read into memory, definitions read from the data files at their byte offset),
  - American IPA from the **CMU Pronouncing Dictionary** (`server/cmudict.js`, ARPAbet converted to IPA),
  - Japanese translations by reading JMdict *backwards*: its English glosses point to Japanese words.
- **Online:** translations into your language come from the word's **Wiktionary** page (its translation tables), and American **recordings** from **Wikimedia Commons**. Answers are saved in `data/english-online.json`, so each word is fetched once. Requests go one at a time and wait when Wikimedia says "too many requests". Failures aren't saved, so they're retried.

**Word status** (new / learning / known / ignored) is stored per dictionary form in `akko-words` (or `akko-words-en`) by `scripts/words/status.js`. Keys 1–4 set it for the word in the popup or under the mouse (`scripts/keys.js`, `scripts/words/hover.js`). Any change fires a `akko-words-changed` event, and every page re-colours itself.

**Mining** (`scripts/mining.js`): "+ mine" saves a card into IndexedDB `mined` with the word, reading, meaning (for English: your translation first, then the definition), the sentence and where it came from. If Anki is set up, it's sent through `/api/anki` → AnkiConnect (`scripts/anki/client.js`). The card can include a screenshot and the line's audio, recorded from the video with `MediaRecorder`, plus the word's pronunciation from `/api/audio`.

## The pages

| Page | Entry script | Main modules |
|---|---|---|
| Watch (`index.html`) | `pages/watch.js` | `player/*` (video, cues, render, settings, 2nd subtitles, dual audio via ffmpeg.wasm, full screen), `subtitles/browser.js` (kitsunekko / JP-Subtitles), `subtitles/opensubs.js` (OpenSubtitles), `search.js` (AniList), `progress.js` (resume), `mining.js`, `anki/panel.js` |
| Read (`reading.html`) | `pages/read.js` | `reader/import.js` (.txt/.epub/.html/subtitles → paragraphs), `reader/library.js`, `reader/text.js`, `reader/manga.js` (+ mokuro OCR through `/api/ocr`) |
| Listen (`podcasts.html`) | `pages/listen.js` | `podcasts/directory.js` (iTunes search, saved shows), `podcasts/feed.js` (RSS + transcripts through `/api/podcasts/fetch`), `podcasts/player.js` |
| Grammar | `pages/grammar.js` | `grammar/lessons.js` (list from `/api/grammar`, each lesson from `/api/grammar/<id>` when opened), `grammar/markdown.js` (a small Markdown renderer) |
| Course | `pages/course.js` | `/api/course` (`server/course.js`), `totals.js` to measure goals |
| Review | `pages/review.js` | flashcards of "learning" words, dates in `akko-review` |
| Settings | `pages/settings.js` | learning / interface / your language, display, OpenSubtitles key, `pages/stats.js`, `backup.js` |

`scripts/site.js` runs first on every page: interface language, the target-language classes, and the first-visit chooser.

### Keeping big books fast

`reader/text.js` puts the whole book in the page as plain paragraphs. An `IntersectionObserver` turns only the paragraphs on or near the screen into clickable words, and turns them back into plain text when they're far away. The whole book is still split into words in the background (in batches of 150 paragraphs) so the "% understood" covers all of it. That % is recalculated at most twice a second. The reading position and % live in the small `akko-reading` record, so scrolling never rewrites the book in IndexedDB.

## Where things are saved

**In the browser** (per site, lost if you clear site data, hence the backup):

| Key / store | What |
|---|---|
| `akko-settings` | target, interface lang, native language, display and player settings |
| `akko-words` / `-en` | word statuses |
| `akko-progress` / `-en`, `akko-subtext:*` | video positions, the subtitle text of recent videos |
| `akko-reading` | reading position and % per book |
| `akko-podcasts` / `-en`, `akko-podcast-progress` / `-en` | saved podcasts, episode positions |
| `akko-grammar` / `-en`, `akko-course` / `-en`, `akko-review` / `-en` | lessons learned, course steps done, review dates |
| `akko-manga` | manga positions |
| IndexedDB `akko` → `texts`, `mined` | books (whole), mined words |

`scripts/backup.js` downloads every `akko-*` key and both IndexedDB stores as one JSON file, and restores it.

**On the server** (`data/`, or `AKKO_DATA` if set: the desktop app uses `%APPDATA%\akko\data`; `server/paths.js`):

| File | What |
|---|---|
| dictionary files | read-only after the first build |
| `ocr/*.mokuro` | OCR results per manga volume |
| `english-online.json` | cached Wiktionary / Commons answers |
| `opensubtitles.json` | your OpenSubtitles API key and login token, never the password |

## External services

| Service | Used for | Needs |
|---|---|---|
| AniList GraphQL | anime search | nothing |
| kitsunekko.net, GitHub (kitsunekko mirror, JP-Subtitles) | Japanese subtitles | nothing |
| OpenSubtitles.com | English subtitles | your free API key |
| iTunes Search API + RSS feeds | podcasts | nothing |
| JapanesePod101, Lingua Libre | Japanese word audio | nothing |
| Wiktionary, Wikimedia Commons | English translations, recordings | nothing (please keep the User-Agent) |
| AnkiConnect (local Anki app) | sending cards | the add-on |
| mokuro (local Python) | manga OCR | `pip install mokuro` |
| Discord (local app) | Rich Presence | a Discord application id in `server/discord.js` |

## Tests

`npm test` runs `tests/*.test.*` with Node's built-in test runner (no extra packages). It runs offline: `AKKO_OFFLINE=1` makes the English lookup skip Wiktionary and Commons.

| File | Covers |
|---|---|
| `tests/japanese.test.js` | kuromoji word grouping, dictionary forms, furigana, what counts as a word, grammar marks, JMdict lookups with conjugation, kanji and pitch accent |
| `tests/english.test.js` | dictionary forms (irregular, suffix rules, context), contractions, function words, grammar marks including "not after" steps, offline lookups (WordNet, CMU IPA, Japanese from JMdict) |
| `tests/lessons.test.js` | settings blocks, the lesson and course APIs, translations, and the whole `check-lessons` run |
| `tests/browser.test.mjs` | browser modules with a pretend localStorage: per-language storage keys, your-language default, word statuses, tokens to HTML, % understood, sentences, the Markdown renderer (including that it's safe), and the Japanese interface dictionary (no repeated keys, placeholders kept) |

`scripts/package.json` (`"type": "module"`) lets Node load the browser modules; browsers ignore it.

Not covered yet: anything that needs a real page (the popup's layout, clicking, video playback, Anki). Those are checked by hand in a browser.

## How to…

- **Add a page:**
  1. Copy an HTML page and keep the sidebar, tabs and `<script type="module" src="/scripts/site.js">`.
  2. Add `scripts/pages/<name>.js`.
  3. Serve it in `server.js` (`app.get('/<name>.html', file('<name>.html'))`).
  4. Add the link to every page's sidebar and tabs.
- **Add an API:** create `server/<name>.js` exporting an Express `router`, then `app.use('/api/<name>', …)` in `server.js`. Wrap async handlers in `asyncRoute` (from `server/http.js`), which turns errors into a JSON `{error}`.
- **Add interface text:** write it in English, then add the Japanese to `scripts/lang/ja.js`. Mark content that must not be translated with `translate="no"` or a `lang` attribute.
- **Add a grammar lesson or course step:** see the READMEs in those folders, then run `npm run check-lessons`.
- **Save something new in the browser:** use `store` from `scripts/core/utils.js` with an `akko-` key (so backups include it), and `keyFor()` if it should be separate per language.
