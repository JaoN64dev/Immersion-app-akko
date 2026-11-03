# Checkpoint — 2026-11-03

Written at the end of a long session, to pick up cold tomorrow with the fewest steps.

## Where the repository is

- The last **code** commit is **`06f6424`** ("Merge pull request #6"): everything from PR #5 (the 3.0.1
  fixes) and PR #6 (ten interface languages). This checkpoint is the docs commit right after it.
- Measured on this commit, today: `npm ci && npm test` → **168 tests, 166 pass, 0 fail**;
  `npm run check-lessons` → *all good*.
- Nothing is half-applied: the working tree is clean. (PR #5 merged at `ca24b2a`, six minutes before
  the languages commit was pushed, so that commit missed the merge and needed PR #6 — both are in
  now. If a change ever "isn't there", check `git log --oneline -3` before doubting the file.)

## What landed in the last two PRs

1. **The dark theme and the new panels.** Five literal colours in the 3.0 CSS (`#fbf7ec` on `#fbf7ec`)
   are now `--post-bg` / `--ink` / `--ink-soft` / `--table-highlight`; `tests/theme.test.js` fails if a
   literal colour comes back to those selectors.
2. **The 3.0 interface strings are translated** in `ja`, `pt`, `es` (plan, priming chips, the Stats
   bands, the language note, speech recognition). The ASR route returns a *code* (`missing` / `model` /
   `ready`) and the page words it, so the server never writes English.
3. **A text is read in the language it is written in.** `scripts/core/script.js` (`scriptOf`, `langOf`,
   `belongsTo`); texts are filed under their own language, misfiled ones are re-filed, and every text
   is tokenized with its own language (`tokenize(lines, lang)`). This is what stopped
   "learn these first" from offering whole sentences.
4. **A language with no dictionary says so**, and **Settings → Dictionary → add from a link** installs
   any Yomitan `.zip` (`POST /api/dictionary/from-url`, fetched on this machine, http(s) only, size
   ceiling, 4 tests in `tests/dict-url.test.js`). This is the way in for the ~25 languages with no pack.
5. **`about.html`** says what's new in ja/pt/es (`data-i18n="about-who"` / `"about-whats-new"`), and
   **`npm run i18n-audit`** lists every English text node that no table covers.
6. **Ten interface languages**: English, 日本語, Português, Español complete (824 entries each);
   **Deutsch, Français, Italiano, Русский, 中文, 한국어** at 147 each — the chrome (menu, every button,
   the settings sections, Review's four answers, the plan). A partial table is fine: whatever it lacks
   stays English. The Settings switch builds itself from `LANGUAGES` in `scripts/i18n.js`.

## Tomorrow, in this order

### 1. Keep filling the six new tables (highest value per hour)

Start with the page you actually open: `settings.html`.

```
npm run i18n-audit -- --lang de      # what German still misses, node by node
```

- A **plain paragraph** needs one key in `scripts/lang/{de,fr,it,ru,zh,ko}.js` (`text:` section).
- A paragraph **split by `<b>`, `<a>`, `<code>`** is several text nodes — no key can match it. Put
  `data-i18n="some-key"` on the paragraph and add one entry to the `html:` section of **all nine**
  tables (ja/pt/es included — `tests/i18n.test.mjs` compares the html key sets of the complete ones,
  and every table must keep the same `href`s).
- English strings in the page are the keys; the test fails on a key English doesn't have, on an empty
  value, and on a lost `{n}` — so typos are caught, not shipped.

Pages left, by number of untranslated text nodes (125 in total):

| page | nodes | | page | nodes |
|---|---|---|---|---|
| settings.html | 32 | | about.html | 11 |
| listening.html | 14 | | index.html | 11 |
| expressions.html | 12 | | review.html | 11 |
| grammar.html | 10 | | reading.html | 9 |
| podcasts.html | 8 | | course.html | 7 |

Do one page, run `npm test`, move on. Never leave a `data-i18n` key without its nine entries.

### 2. Then phase 4 of `docs/ideas-3.0.md`

- subtitles from audio **on the watch page** — needs audio out of a video: decide ffmpeg in the browser
  (`@ffmpeg/core` is already a dependency) or on the server.
- **model download with a pinned URL and a hash** — done: `POST /api/asr/model` downloads
  `ggml-base.bin` (~148 MB) from the pinned whisper.cpp model URL above, checks its sha256, and saves
  it to `~/.cache/akko/whisper` — the folder Settings already points people at. The download button
  shows in Settings → speech recognition once a tool is installed but no model exists yet.
- mining from anything (URL / PDF page) → the reader; Reader 2.0 (read-aloud, per-book word lists);
  card templates v2.
- Phase 5 (`.apkg`, shadowing, handwriting, PWA, cloud v2, the local assistant) is untouched.

### 3. Small, if there is time

- the pack installer leaves nothing installed when `oneAtATime` refuses (it should say why);
- coverage in the library list *before* the planner runs (idea 3, last open box);
- retention by source and "time to the next level" (Stats).

## Decisions waiting on you

- **How far to take the six tables**: reaching 824 in each is ~4,000 strings of real translation; the
  honest plan is page by page, starting with settings and the first screen.

### Decided since this checkpoint

- **Whisper model**: pinned to `ggml-base.bin` — the multilingual base (~148 MB) from
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`, sha256
  `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`, saved to
  `~/.cache/akko/whisper` and checked against the hash before use. `POST /api/asr/model` downloads
  it — one click in Settings → speech recognition once whisper-cli is on PATH.
  `AKKO_WHISPER_MODEL` remains the escape hatch, and akko still ships no model.
- **ffmpeg**: browser-side `@ffmpeg/ffmpeg` (already a dependency, used by dual-audio.js to switch
  audio tracks). It runs in the browser, keeping with the "runs for free, nothing to install" rule,
  and extracts a locally opened video's audio to WAV for Whisper. Remote URLs can't be read by
  ffmpeg.wasm, so watch-page subtitles-from-audio works for local files; server-side ffmpeg stays an
  option for URLs later.

### What phase 4's ASR item now covers

- local ASR machine half (`server/asr.js`: finds whisper-cli/whisper/faster-whisper, runs it, SRT out)
- one-click model download (`POST /api/asr/model`, pinned sha256, `~/.cache/akko/whisper`)
- reader page half (`読む` → subtitles from audio)
- watch page half (index.html → ffmpeg.wasm extracts audio → `/api/asr/transcribe` → subtitles)
- in-app install instructions (Settings → speech recognition, all nine tables)

Nothing is uploaded either way.

## After this checkpoint: the English course was hidden

`pagesFor()` in `scripts/core/target.js` gave the course and the grammar to Japanese only
(`course: !!p.lessons`), so choosing **English** as the language you learn made `scripts/site.js`
delete the 道 and 文法 tabs and put "This page is for Japanese" on `course.html` — while `course-en/`
(8 steps), `grammar-en/` (38 lessons) and `server/{course,grammar}.js`'s `DIRS = { ja, en }` were all
there, translated into pt/es/ja. English now has `course: true, grammar: true` in the language table,
`pagesFor` uses them, and 聴解/表現 stay Japanese by design. `tests/languages.test.mjs` checks both the
flags and that the folders behind them exist.

## Traps, so they are not rediscovered

- No literal colours in new CSS — `tests/theme.test.js` guards the 3.0 selectors; use the theme vars.
- `keys` means both "the keyboard page" and "dictionary keys": when adding a key, make sure the English
  exists (`npm run i18n-audit` prints coverage, `tests/i18n.test.mjs` rejects orphans).
- `scripts/pages/settings.js` already imports `LANGUAGES` (the languages you *learn*); the interface
  languages come in as `LANGUAGES as UI_LANGUAGES` from `scripts/i18n.js`. Do not merge the two.
- Tests need `node_modules`: `npm ci` before `npm test` (about 12 s), or 20 files fail with
  `Cannot find module 'express'` — that is not a real failure.
- Never add an agent `Co-authored-by`; `rm -f .git/hooks/commit-msg` if a hook reappears.
- `git fetch origin --prune` before trusting a stale local branch.

### Whisper, in short

The recognition half works: `server/asr.js` finds whisper-cli / whisper / faster-whisper on PATH
(or `AKKO_WHISPER`), runs it, and returns an SRT — 4 tests cover it, including a tool that writes
nothing being an error rather than an empty subtitle.

What made it "not work even when it was installed": there was no model, and no way to get one
through akko. whisper.cpp transcribes nothing without a `.bin` model, so akko reported
`code: 'model'` and refused to transcribe. Fixed by `POST /api/asr/model`: one click in
Settings → speech recognition downloads the pinned `ggml-base.bin` (~148 MB) into
`~/.cache/akko/whisper` and checks its sha256. Point `AKKO_WHISPER_MODEL` at your own model if you
prefer placing it by hand; nothing is uploaded either way.

## Commands

```
git fetch origin --prune && git checkout main1 && git pull --ff-only origin main1 && npm ci
npm test                     # 173 tests, 171 pass, 0 fail, 2 skipped
npm run check-lessons
npm run i18n-audit           # coverage of every table + the English left on the pages
npm run i18n-audit -- --lang ko
npm start                    # http://localhost:3000, offline: AKKO_OFFLINE=1 AKKO_PORT=3987
```

## Loose ends, nothing blocking

- Chrome Web Store listing ($5, optional), Apple Developer ID (optional, macOS keeps the download page).
- `git revert a196451` if the secret sweep should be undone (it should not).
