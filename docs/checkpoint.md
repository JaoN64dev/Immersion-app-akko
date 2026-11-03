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
- **model download with a pinned URL and a hash** — the one thing between "nothing installed" and
  "working". Needs a host that stays put (GitHub release, like the dictionary packs).
- mining from anything (URL / PDF page) → the reader; Reader 2.0 (read-aloud, per-book word lists);
  card templates v2.
- Phase 5 (`.apkg`, shadowing, handwriting, PWA, cloud v2, the local assistant) is untouched.

### 3. Small, if there is time

- the pack installer leaves nothing installed when `oneAtATime` refuses (it should say why);
- coverage in the library list *before* the planner runs (idea 3, last open box);
- retention by source and "time to the next level" (Stats).

## Decisions waiting on you

- **Whisper model**: which URL to pin (and its hash) — akko must not ship a model.
- **ffmpeg**: browser-side (no install, slower) or server-side (needs ffmpeg on the machine)?
- **How far to take the six tables**: reaching 824 in each is ~4,000 strings of real translation; the
  honest plan is page by page, starting with settings and the first screen.

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

## Commands

```
git fetch origin --prune && git checkout main1 && git pull --ff-only origin main1 && npm ci
npm test                     # 168 tests today
npm run check-lessons
npm run i18n-audit           # coverage of every table + the English left on the pages
npm run i18n-audit -- --lang ko
npm start                    # http://localhost:3000, offline: AKKO_OFFLINE=1 AKKO_PORT=3987
```

## Loose ends, nothing blocking

- Chrome Web Store listing ($5, optional), Apple Developer ID (optional, macOS keeps the download page).
- `git revert a196451` if the secret sweep should be undone (it should not).
