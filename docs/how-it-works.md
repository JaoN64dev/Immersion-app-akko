# How akko works

This explains the code behind the app: how the pieces fit, where each feature lives, how data moves and where it's saved. It's for anyone changing the code. To *use* the app, see the main [README](../README.md); to write lessons, see [grammar/README.md](../grammar/README.md) and [course/README.md](../course/README.md).

## The big picture

akko is two programs that run on your own computer:

- **A small server** (Node.js + Express, `server.js` and `server/`). It serves the pages, and does what a browser can't do alone: split Japanese and English into words, look words up in big offline dictionaries, fetch subtitle sites and podcast feeds (browsers block most of those), talk to Anki, run manga OCR.
- **The pages** (`*.html`, `style.css`, `scripts/`). Plain HTML and JavaScript modules, no framework and no build step. Everything you do (progress, mined words, books, stats) is saved **in the browser**, not on the server. The exception is the **word list**, which the server keeps so every window, browser, phone and the extension share it (see [One word list](#one-word-list)).

A third, optional piece is the **browser extension** (`extension/`), which brings the subtitles and the popup to YouTube and Netflix and uses the same server (see [The browser extension](#the-browser-extension-youtube-and-netflix)).

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

Start the server with `npm start` (or `start-akko.bat` on Windows, which also opens the browser). It listens on `http://127.0.0.1:3000`, only reachable from your own computer. Websites open in your browser can still send requests to it, so `server/guard.js` answers only at 127.0.0.1 / localhost (against DNS rebinding) and refuses POST/PUT/DELETE whose `Origin` is another site, and any `/api/` request a browser marks as cross-site (`Sec-Fetch-Site`). The one exception is akko's own extension, `chrome-extension://cflgdipimeohhbeadldfgaohdcnnkcol` (its id is fixed by the `key` in its manifest; `AKKO_EXTENSIONS=<id>,…` adds others). Tested in `tests/guard.test.js`.

The **desktop app** (`electron/main.js`, built with `npm run dist`) is the same thing in a window. It sets `AKKO_DATA` to a folder in the user profile, copies the bundled dictionary files there on the first start, calls `start(3417)` from `server.js`, and opens a window on that address. The port never changes, because the window's storage (words, books…) belongs to the address. Links to other sites open in the normal browser, unless the link says `target="akko-window"`: then the site opens in a new window inside akko (sandboxed like a browser tab, and free to browse); `target="_blank"` on an akko page opens a new akko window. These rules apply to every window (`web-contents-created` in `electron/main.js`). New windows that a site opened this way asks for (ads, pop-ups) stay inside akko too, so they never reach the normal browser. Once a day, and from Help → Check for updates, the app asks GitHub for the newest release (`checkForUpdate`; `AKKO_UPDATE_URL` points it elsewhere for testing): the installed app downloads it with electron-updater and installs it when you restart, the portable one offers to open the download page. On each start it asks (a native dialog, before the server starts) whether to open the **app window** or the **browser**, unless `--browser` / `--window` is given or a choice was remembered (`desktop.json` in the user profile; the akko menu → When akko starts). In **browser mode** no window opens: the app shows a tray icon, keeps the server running and opens the address in the default browser. `npm run desktop` runs it from the code (through `electron/run.js`, which removes `ELECTRON_RUN_AS_NODE`: VS Code terminals set it, and it stops Electron from opening a window).

## Folders

| Folder / file | What's in it |
|---|---|
| `server.js` | Starts Express, mounts the API routes, serves the pages and static folders. `start(port)` is exported for the desktop app |
| `electron/` | The desktop app: `main.js` (window + server), `run.js` (`npm run desktop`), icons |
| `server/` | One module per API (dictionary, English, grammar, subtitles…), see below |
| `*.html` | One file per page: `index.html` (Watch), `reading.html`, `podcasts.html`, `listening.html`, `grammar.html`, `course.html`, `review.html`, `settings.html`, `about.html` |
| `scripts/pages/` | The entry script of each page (`watch.js`, `read.js`, `listen.js`, `listening.js`, `grammar.js`, `course.js`, `review.js`, `settings.js`, `stats.js`) |
| `scripts/` (other folders) | Shared browser code, grouped by feature (`words/`, `player/`, `reader/`, `podcasts/`, `anki/`, `grammar/`, `core/`) |
| `scripts/lang/ja.js` | The Japanese translation of the interface |
| `grammar/`, `grammar-en/` | Grammar lessons as Markdown, Japanese and English |
| `listening/` | 聴解 listening exercises as Markdown (Japanese only) |
| `course/`, `course-en/` | Course steps as Markdown; `course/pt`, `/es` and `course-en/pt`, `/es`, `/ja` are translations |
| `data/` | Dictionary files (`dict.json`, `kanji.json`, `accents.txt`), and things the server saves: `ocr/`, `speech/`, `english-online.json`, `opensubtitles.json`, `companion.json`… (see [Where things are saved](#where-things-are-saved)) |
| `extension/` | The akko companion browser extension (Manifest V3), see [below](#the-browser-extension-youtube-and-netflix) |
| `website/` | akko's one-page website, published by `.github/workflows/website.yml` |
| `tools/` | `check-lessons.js` (`npm run check-lessons`), `pack-extension.js` (`npm run pack-extension`: `dist/akko-companion-<version>.zip`) |
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

1. **Lindera** (WebAssembly, the IPADIC dictionary built in) splits the line into morphemes (食べ / て / いる). `server/tokenizer.js` gives its tokens kuromoji's shape (`surface_form`, `pos`, `pos_detail_1`…, `basic_form`, `reading`), which the rest of the code reads (akko used kuromoji before; same dictionary, same parts of speech, ~65 MB less memory). Words Lindera doesn't know get kuromoji's categories for unknown words by their kind of character.
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

`detect(tokens, lang)` slides every rule along the line's tokens (the morphemes for Japanese, the word pieces for English). `matchAt` checks one starting position.

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

JMdict is big (218,000 entries), so it isn't turned into objects all at once: `readDict` keeps the file's bytes and notes where each entry starts and ends, and `Entries.get(i)` parses an entry when it's looked up (the last 5,000 stay parsed). The index maps each spelling and reading to an entry number, or a list when there are several. This keeps about 140 MB out of the server's memory; a lookup still takes well under a millisecond.

JMdict and KANJIDIC2 can be replaced while the app runs, from **Settings → Dictionary**: `POST /api/dictionary/upload` (the file as the body: a jmdict-simplified `jmdict-eng-….json.zip` or `kanjidic2-en-….json.zip`, or the `.json` inside) or `POST /api/dictionary/update` (downloads the newest of both from jmdict-simplified's GitHub releases). The file is checked, squeezed like on the first start, written next to the old one and renamed over it, then swapped in memory (`useDict`); English mode's reverse index (`buildVocab`) rebuilds because it remembers which dictionary it was built from. `GET /api/dictionary` says what's installed. Tested in `tests/dictionary-install.test.js`.

**Frequency lists** are Yomitan zips with `term_meta_bank` files and no `term_bank`: stored the same way (one line per word: value to sort `v`, value to show `f`, reading `r`), listed with `kind: "freq"`; `/api/dict` adds `freq: [{title, value}]` to each entry (`frequencies()`), shown as badges in the popup. An added dictionary's entry can be mined: the popup turns its glossary into plain text (`minable()` in `scripts/popup.js`).

**Dictionaries you add** (`server/dictionaries.js`): Yomitan-format zips go through the same upload route, which recognizes them (`index.json` + `term_bank_*.json`) and calls `importZip`. Each one is stored in `<data>/dictionaries/<id>/`: `terms.jsonl` (one entry per line, its meanings already turned into safe HTML: only plain formatting tags, no attributes except `yd-*` classes from Yomitan's `data` names and `lang`; no links, images, scripts or styles), `keys.txt` (every word and reading, sorted) and `index.bin` (where each key's lines are). A lookup halves the sorted keys to find the word and reads only those lines, so Jitendex (440,000 entries, 230 MB on disk) costs about 35 MB of memory and a lookup takes a few milliseconds. `/api/dict` adds them as `more: [{title, entries}]`, for each dictionary that's on, in the order of `list.json`, only for the language you're learning; the popup shows them under JMdict (`moreHtml` in `scripts/popup.js`). A newer version replaces the old one when its `indexUrl` (or else its title) matches. Tested in `tests/yomitan.test.js`.

**English** (`server/english.js` → `entryFor`):

- **Offline:**
  - definitions from **WordNet** (`server/wordnet.js`; the index is read into memory, definitions read from the data files at their byte offset),
  - American IPA from the **CMU Pronouncing Dictionary** (`server/cmudict.js`, ARPAbet converted to IPA),
  - Japanese translations by reading JMdict *backwards*: its English glosses point to Japanese words.
- **Online:** translations into your language come from the word's **Wiktionary** page (its translation tables), and American **recordings** from **Wikimedia Commons**. Answers are saved in `data/english-online.json`, so each word is fetched once. Requests go one at a time and wait when Wikimedia says "too many requests". Failures aren't saved, so they're retried.

**Word status** (new / learning / known / ignored) is stored per dictionary form in `akko-words` (or `akko-words-en`) by `scripts/words/status.js`. Keys 1–4 set it for the word in the popup or under the mouse (`scripts/keys.js`, `scripts/words/hover.js`). Any change fires a `akko-words-changed` event, and every page re-colours itself. The list is shared through the server (see [One word list](#one-word-list)): changes made on a page wait in `akko-words-pending` until the server has them.

**Mining** (`scripts/mining.js`): "+ mine" saves a card into IndexedDB `mined` with the word, reading, meaning (for English: your translation first, then the definition), the sentence and where it came from. If Anki is set up, it's sent through `/api/anki` → AnkiConnect (`scripts/anki/client.js`). The card can include a screenshot and the line's audio, recorded from the video with `MediaRecorder`, plus the word's pronunciation from `/api/audio`. The screenshot and the line's audio are also kept in akko, with or without Anki (IndexedDB `media`, keyed by the card's id, `scripts/core/media.js`; the Anki panel's "keep … in akko" switch, `keep` in `akko-anki`), so 復習 can show the scene and play the line. They're left out of backups (a backup is text).

## The pages

| Page | Entry script | Main modules |
|---|---|---|
| Watch (`index.html`) | `pages/watch.js` | `player/*` (video, cues, render, settings, 2nd subtitles, dual audio via ffmpeg.wasm, full screen), `subtitles/browser.js` (kitsunekko / JP-Subtitles), `subtitles/opensubs.js` (OpenSubtitles), `search.js` (AniList), `progress.js` (resume), `mining.js`, `anki/panel.js` |
| Read (`reading.html`) | `pages/read.js` | `reader/import.js` (.txt/.epub/.html/subtitles → paragraphs), `reader/library.js`, `reader/text.js`, `reader/manga.js` (+ mokuro OCR through `/api/ocr`) |
| Listen (`podcasts.html`) | `pages/listen.js` | `podcasts/directory.js` (iTunes search, saved shows), `podcasts/feed.js` (RSS + transcripts through `/api/podcasts/fetch`), `podcasts/player.js` |
| 聴解 Listening (`listening.html`, Japanese only) | `pages/listening.js` | `listening/speech.js` (audio from `/api/speech`, or the browser's voice), sets from `/api/listening` (`server/listening.js`), sentence drills from the grammar examples |
| Grammar | `pages/grammar.js` | `grammar/lessons.js` (list from `/api/grammar`, each lesson from `/api/grammar/<id>` when opened), `grammar/markdown.js` (a small Markdown renderer) |
| Course | `pages/course.js` | `/api/course` (`server/course.js`), `totals.js` to measure goals |
| Review | `pages/review.js` | flashcards of "learning" words, scheduled by `words/fsrs.js` (see [復習](#復習-spaced-repetition-fsrs)), with the mined sentence, picture and line (`core/media.js`) |
| Settings | `pages/settings.js` | learning / interface / your language, display, OpenSubtitles key, `pages/stats.js`, `backup.js` |

`scripts/site.js` runs first on every page: interface language, the target-language classes, and the first-visit chooser.

### Keeping big books fast

`reader/text.js` puts the whole book in the page as plain paragraphs. An `IntersectionObserver` turns only the paragraphs on or near the screen into clickable words, and turns them back into plain text when they're far away. The whole book is still split into words in the background (in batches of 150 paragraphs) so the "% understood" covers all of it. That % is recalculated at most twice a second. The reading position and % live in the small `akko-reading` record, so scrolling never rewrites the book in IndexedDB.

## Subtitles inside the video file

`scripts/player/file-subs.js`: when a local video is opened, `player/dual-audio.js` already asks ffmpeg.wasm for the file's streams; the subtitle ones are passed on (`onSubtitleTracks`). Text formats (srt, ass, vtt…) are listed in a bar on the Watch page; picture formats (PGS, DVD) can't be read as text and are left out. `extractSubtitle()` copies one track out (ass kept as ass, the rest turned into srt) and it's loaded like a subtitle file, as the main or 2nd subtitles. If no subtitles are loaded yet, a track in the language you're learning is used right away (skipping "Signs & Songs" tracks).

## Listening exercises and speech

`server/listening.js` reads `listening/*.md` (the sets that come with akko) and `<data folder>/listening/*.md` (your own, ids starting with `my-`; the folder is made on the first visit with the guide and template copied in), format: [listening/README.md](../listening/README.md). A question with `audio: file.mp3 [start-end]` plays that recording instead of the voices, served by `/api/listening/audio` only from the set's own folder and only if a question uses it. It also makes the 文 sentence drills from the grammar lessons' examples of a level. `server/voicevox.js` runs VOICEVOX's engine: on start it looks for one (akko's own download in `<data>/voicevox/engine`, the VOICEVOX installer's folder, winget's) and starts `run.exe` with no window unless that's turned off (`<data>/voicevox/akko.json`); the engine akko started stops with akko (process exit, Ctrl+C, the desktop app's `will-quit`). Its install route downloads the `windows-cpu` `.vvpp` (a zip) from VOICEVOX's latest GitHub release and unpacks it with Windows' `tar`; nothing of VOICEVOX ships with akko. The audio comes from `server/speech.js`, which has two engines: **VOICEVOX** (or AivisSpeech, same API), used when that program is open (it asks `127.0.0.1:50021` / `:10101`, or `AKKO_VOICEVOX`; `pickVoices` chooses a calm woman's, man's and narrator's voice, each a different speaker), and **Windows' own voices**, through one hidden PowerShell process (WinRT `SpeechSynthesizer`). Each line becomes a `.wav` saved in `data/speech/`, so it's made once. It's done on the server because the desktop app's window (Electron) has no voices of its own. `scripts/listening/speech.js` lists what can speak, best first: VOICEVOX, the browser's natural online voices (Edge, Chrome), Windows, other browser voices; the page's **voice** menu picks one. VOICEVOX's voices are credited under the exercise. The page also has 書き取り dictation (both sentences are split into words by `/api/tokenize` and compared by their reading in hiragana, so kana answers count), 復習 mistakes (`akko-listening-mistakes`), exam mode and a ▶ per line.

## Skip intro

`scripts/player/skip.js`: when a video loads, it works out the show (the one picked in the AniList search if the file name looks like it, else an AniList search for the name from `titleFromFile`, with `Season N` added from `seasonFromFile`) and the episode (`episodeOf`), then asks AniSkip (`api.aniskip.com/v2/skip-times/<MyAnimeList id>/<episode>`) for the opening and ending; answers are cached in `akko-skip-cache`. A button over the video offers the skip while one is playing (K presses it; "skip openings by itself" in the player settings skips each one once). Without AniSkip times, I marks an opening's start and end; it's kept per show in `akko-intros`, and the button then shows within a minute of that time and skips its length. K with nothing to skip jumps 85 s.

## The welcome screen and "today"

`scripts/site.js` shows the welcome screen once each time akko is opened (`sessionStorage`, and not when the page was opened from another akko page), unless it's turned off (`welcome: false` in akko-settings). `scripts/core/today.js` counts time per day: every 15 seconds, 15 seconds are added if a video or audio is playing, or the Read, Review or 聴解 page is in front and was used in the last minute. Saved as `akko-days` / `akko-days-en`; the streak counts days with at least a minute.

## The browser extension (YouTube and Netflix)

`extension/` is a Manifest V3 extension for Chrome and Edge. It has no dictionary of its own: everything goes through akko's server, found by `background.js` at the address that worked last, then ports 3417 and 3000 (`GET /api/hello` must answer `{app: "akko"}`, so another program on the same port isn't mistaken for it).

| File | What it does |
|---|---|
| `page/youtube.js` (in YouTube's own page, "MAIN world") | YouTube only gives subtitles to its own player (the request needs a token), so this listens in on the player's `/api/timedtext` downloads and asks the player to switch tracks. When the first download comes back empty, it retries; once one address with the token worked, it fetches the other tracks directly |
| `content/generic.js` (any other site, injected by the popup's "Use akko on this page") | finds the page's biggest video (or reports the big iframes it may be in, so the popup can ask for that address: `optional_host_permissions`), takes a subtitle file dropped on the video or picked (srt / vtt / ass; mostly Japanese → akko's subtitles, otherwise the translation); records from the tab, like Netflix |
| `page/netflix.js` (in Netflix's page) | adds WebVTT to the subtitle formats the player asks for (`JSON.stringify`), reads the track list from the answer (`JSON.parse`, `Response.json`) and keeps it per title; also catches the subtitle files the player downloads, as a backup; seeks through Netflix's player API |
| `content/youtube.js`, `content/netflix.js` | find the video and its Japanese track, parse json3 / WebVTT / TTML, hide the site's own subtitles, pick a translation; wait out YouTube's ads |
| `content/common.js` | the overlay (in a shadow root inside the player, so it works in full screen): the line, the popup (`/api/dict`, `/api/audio`, `/api/grammar` for lesson links), the ☰ list of lines, ★ on i+1 lines, keys, the settings panel, mining, the time watched |
| `background.js` | the only part that talks to akko (pages can't reach `http://127.0.0.1` from https); the outbox for akko; recording the tab |
| `offscreen.js` | records the tab's sound for Netflix cards (only a page can record) |
| `popup.*`, `options.*` | the toolbar popup, the options page |

**Mining.** On YouTube the line's audio is recorded from the video (`captureStream` + `MediaRecorder`) and the picture drawn from it. Netflix's video is copy-protected, so `site.recordable` / `site.screenshot` are `"tab"`: the sound is recorded from the tab (`chrome.tabCapture.getMediaStreamId` → `offscreen.js`) and the picture is `chrome.tabs.captureVisibleTab`, cropped to the video. Chrome only allows both after the user has clicked the extension's toolbar button on that tab (`activeTab`). Cards go to Anki through akko's `/api/anki`, and to akko's mined list.

**Keeping in step with akko** (`server/companion.js`, `scripts/core/companion.js`). The word list lives in each akko window's storage, which the extension can't reach, so the server is the meeting point:

- The extension sends its **word statuses** with the log, but they go straight into the shared word list (`server/words.js`), not the log.
- The rest goes into a **log** (`POST /api/companion/log`): mined words, time watched (per video and day). A mined word's picture and line audio are sent first (`POST /api/companion/media/<id>`, kept in `<data>/companion-media/` as long as the log) and the card says which it has. Entries wait in the extension's `outbox` while akko is closed.
- Every akko window on the computer (`scripts/core/companion.js`, every 20 s; not on a phone) reads the log from where it got to (`GET /api/companion/log?after=&epoch=`), applies it to its own storage (IndexedDB `mined` and, fetched from the server, `media`; `akko-days`; `akko-companion-watched`), then sends its Anki settings and language (`PUT /api/companion/app`). The desktop app's window and akko in a browser each catch up separately, so both get everything. A Web Lock keeps two tabs of one browser from applying it twice.
- The extension reads `GET /api/companion?from=extension`: the shared word list, akko's Anki settings and language.
- The log keeps 5000 entries, 60 days at most. Tested in `tests/companion.test.js`.

The desktop app ships the folder next to itself (`resources/extension`, outside the app archive so Chrome can load it; `extraResources` in `package.json`); `AKKO_EXTENSION` tells the server where it is, for Settings → open the extension folder (`POST /api/companion/extension/open`, the computer only).

## One word list

`server/words.js` keeps the word statuses (one list per language) in `<data>/words.json`, with a numbered journal of the last 20,000 changes. Every page (`scripts/core/words-sync.js`, started by `site.js`, also on phones) keeps a copy in localStorage and syncs: 1.5 s after a word is marked, every 5 s while the page is in front (a minute behind), and when it comes back to the front.

- `POST /api/words/sync {lang, id, since, changes}`: the page sends what changed there (`akko-words-pending`, filled by `scripts/words/status.js`) and gets back what changed elsewhere since `since`, or the whole list when it's new, too far behind, or from another `words.json` (`id`).
- The first time, the page's whole list is merged in (`merge`): words the server doesn't have are added; for a word both have, the server's status stays. After a backup is restored (`restored()` from `scripts/backup.js`), the backup's statuses win instead.
- Words still waiting to be sent keep their status from the page (`applyRemote` in `status.js`), so a change made during a sync isn't undone.
- Tested in `tests/words.test.js` (merging, catching up, restores, bad input).

## 復習: spaced repetition (FSRS)

`scripts/words/fsrs.js` is FSRS-4.5 with its default weights (what Anki uses): a card has a stability (days until the chance to remember it drops to 90%) and a difficulty; each grade (again / hard / good / easy) updates both, and the next review is when the chance is 90%. Pure functions, tested in `tests/fsrs.test.mjs`. `scripts/pages/review.js` builds a session from the "learning" words: the ones due, then up to 20 never reviewed (`akko-review-new` counts them per day). "Again" brings a word back in the same session. A word whose next review is 21 days or more away becomes known (the same rule as the Anki import). Cards are in `akko-review` / `-en` (`{s, d, due, last, reps, lapses}`); older cards (`{last, again, good}`) start again as new.

## The samples

`samples/` (served at `/samples`, see [samples/README.md](../samples/README.md)): `wagahai.webm` + `.srt` (Watch → "try a sample", `pages/watch.js`) and `wagahai-1.txt`, added to the Read library the first time it’s empty (`addSample` in `pages/read.js`, once per language: `akko-sample-text` / `-en`; English gets `alice-1.txt`).

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
| `akko-listening`, `akko-listening-mistakes`, `akko-listening-view` | best score per listening set, questions you got wrong, the page's settings (level, speed, voice…) |
| `akko-skip`, `akko-skip-cache`, `akko-intros` | skip openings by itself, AniSkip answers, the openings you marked per show |
| `akko-days` / `-en` | seconds with the language per day (welcome screen: today, streak) |
| `akko-companion-at`, `akko-companion-watched` | how far this window got in the extension's log; the YouTube / Netflix videos watched (Stats) |
| `akko-words-pending` / `-en`, `akko-words-sync` | word statuses not yet sent to the server; where this page got to in the shared list |
| `akko-review-new` / `-en`, `akko-sample-text` | new words reviewed today; whether the sample novel was added |
| IndexedDB `akko` → `texts`, `mined`, `media` | books (whole), mined words, a mined word's picture and line audio (not in backups) |

`scripts/backup.js` downloads every `akko-*` key and both IndexedDB stores as one JSON file, and restores it.

**On the server** (`data/`, or `AKKO_DATA` if set: the desktop app uses `%APPDATA%\akko\data`; `server/paths.js`):

| File | What |
|---|---|
| dictionary files | read-only after the first build |
| `ocr/*.mokuro` | OCR results per manga volume |
| `english-online.json` | cached Wiktionary / Commons answers |
| `listening/` | your own listening sets and their recordings |
| `voicevox/` | VOICEVOX's engine if akko downloaded it, and `akko.json` (start it with akko or not) |
| `backups/akko-auto-*.json` | automatic backups (the last 10), sent by the pages every 3 days (`scripts/core/auto-backup.js`, `server/backups.js`) |
| `lan.json` | phone / tablet access: on or off, the PIN, signed-in devices (hashed tokens) |
| `speech/*.wav` | lines said by Windows' Japanese voices, made once (listening exercises) |
| `opensubtitles.json` | your OpenSubtitles API key and login token, never the password |
| `words.json` | the shared word list, both languages, and the last changes |
| `companion.json`, `companion-media/` | the extension's log, akko's Anki settings and language for it, when it last asked; the recordings of mined words |

## External services

| Service | Used for | Needs |
|---|---|---|
| AniList GraphQL | anime search | nothing |
| kitsunekko.net, GitHub (kitsunekko mirror, JP-Subtitles) | Japanese subtitles | nothing |
| OpenSubtitles.com | English subtitles | your free API key |
| iTunes Search API + RSS feeds | podcasts | nothing |
| JapanesePod101, Lingua Libre | Japanese word audio | nothing |
| Wiktionary, Wikimedia Commons | English translations, recordings | nothing (please keep the User-Agent) |
| AnkiConnect (local Anki app) | sending cards | the add-on (`AKKO_ANKI` if it isn't at `127.0.0.1:8765`) |
| YouTube, Netflix (in the browser, through the extension) | subtitles the player already downloads | the extension; a Netflix account |
| mokuro (local Python) | manga OCR | `pip install mokuro` |
| Discord (local app) | Rich Presence | a Discord application id in `server/discord.js` |

## Themes, backups, phones, updates

- **Dark theme** (`scripts/core/theme.js`): colours are CSS variables; the dark set is at the end of `style.css`, used when the computer is dark ("auto", through `prefers-color-scheme`, no class) or when picked (`theme-dark` on `<html>`). `--card`, `--ink`, `--on-panel`… are the light/dark-sensitive ones; use them instead of fixed colours.
- **Automatic backups**: every page calls `autoBackup.start()`; every 3 days one tab builds the same file as Settings → Backup (`scripts/core/backup-file.js`) and posts it to `/api/backups`, which keeps the last 10.
- **Phones** (`server/lan.js`): off by default. When on, a second server listens on all addresses at port + 1; `server/guard.js` sends those requests through `lanGuard` (private addresses only, an IP address as Host, a sign-in cookie from the PIN) before the usual checks. `/api/lan` (settings, PIN) answers the computer only.
- **Builds for every system** (`.github/workflows/build.yml`): a version tag starts it. The tests run on Linux, then akko is built on Windows, macOS (`.dmg`, Apple Silicon and Intel) and Linux (`.AppImage`), each on its own GitHub runner, unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`), and all the files go into a draft release. The Windows-only parts check `process.platform` (VOICEVOX's installer, Windows' voices, the update installer), so the Mac and Linux apps leave them out; their update check opens the download page.
- **Updates** (`electron/main.js`): the GitHub check decides whether there's a newer version; the installed app then uses electron-updater, which reads the release's `latest.yml` (made by `npm run dist`; upload it with the installer and its `.blockmap`, plus the portable `.exe` and the extension's zip).
- **Installer size**: `package.json`'s `build.files` leaves out what akko never loads (ffmpeg's `umd` copy, WordNet's `index.sense`, tests, docs, the website, your data), and `electronLanguages` keeps Chromium's own texts in English, Portuguese, Spanish and Japanese only.
- **Hearing Japanese anywhere** (`scripts/core/say.js`): the popup's 🔊 / ▶ sentence and the grammar examples use the listening page's voices; Anki cards without a recorded line get `/api/speech` audio of the sentence.

## Tests

`npm test` runs `tests/*.test.*` with Node's built-in test runner (no extra packages). It runs offline: `AKKO_OFFLINE=1` makes the English lookup skip Wiktionary and Commons.

| File | Covers |
|---|---|
| `tests/japanese.test.js` | word grouping (Lindera's morphemes), dictionary forms, furigana, what counts as a word, grammar marks, JMdict lookups with conjugation, kanji and pitch accent |
| `tests/english.test.js` | dictionary forms (irregular, suffix rules, context), contractions, function words, grammar marks including "not after" steps, offline lookups (WordNet, CMU IPA, Japanese from JMdict) |
| `tests/lessons.test.js` | settings blocks, the lesson and course APIs, translations, and the whole `check-lessons` run |
| `tests/voicevox.test.js` | installing VOICEVOX from a pretend release (terms required, download, unpack, found first), the "start it with akko" setting |
| `tests/backups.test.js`, `tests/lan.test.js` | automatic backups (kept, pruned, only those files served); phone access (off by default, PIN, wrong-PIN limit, Host checks, the computer alone changes it) |
| `tests/listening.test.js` | the listening file format and its error messages, the sets that come with akko (N5–N1, all valid and translated), sentence drills, and Windows speech to `.wav` (skipped without a Japanese voice) |
| `tests/guard.test.js` | who may use the API: akko's pages, programs on the computer, akko's extension; not other websites or other extensions; DNS rebinding |
| `tests/words.test.js` | the shared word list: merging pages in, catching up with only the changes, a restored backup winning, English apart, bad input |
| `tests/fsrs.test.mjs` | 復習's schedule: first intervals, gaps growing, lapses, helpers |
| `tests/companion.test.js` | the extension's log (only valid entries kept), akko windows catching up, the word list the extension sees, the extension folder (not shown to or opened by a phone) |
| `tests/browser.test.mjs` | browser modules with a pretend localStorage: per-language storage keys, your-language default, word statuses, tokens to HTML, % understood, sentences, the Markdown renderer (including that it's safe), and the Japanese interface dictionary (no repeated keys, placeholders kept) |

`scripts/package.json` (`"type": "module"`) lets Node load the browser modules; browsers ignore it.

Not covered yet: anything that needs a real page (the popup's layout, clicking, video playback, Anki) and the extension on YouTube / Netflix. Those are checked by hand in a browser.

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
