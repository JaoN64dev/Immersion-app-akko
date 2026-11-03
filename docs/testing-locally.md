# Testing the 3.0 branch locally

The branch is `arena/0d0f7fe9-immersion-app-akko`. It is **not a release**: phases 1–3 of
`docs/ideas-3.0.md` are finished, phase 4 has its first piece (speech recognition, machine half + the
読む button), phase 5 is untouched. Everything below is what to try, and what "working" looks like, so
you can find the things I cannot: a page that throws, a picker that does not reload, a number that
disagrees with itself.

## Run it

```bash
git fetch origin
git checkout arena/0d0f7fe9-immersion-app-akko
npm ci
npm start          # http://127.0.0.1:3000  (AKKO_PORT=xxxx to use another port)
```

First start downloads JMdict/KANJIDIC2 (~13 MB) and starts the tokenizer; the terminal says
`dictionary: ready` when it is done. Until then, pages that need Japanese wait rather than break.

```bash
npm test             # 142 pass, 2 skipped
npm run check-lessons
```

## What to try, in order

**1. The welcome screen and any language (phase 1–2)**
- Start akko: the welcome dialog offers 日本語 and English as cards, and **"or another language"** under
  them with 28 more. Pick **Deutsch** → the page reloads, the menu loses 道 course / 文法 grammar /
  聴解 drills / 表現 (they are Japanese lessons), and Settings → Learning says what German gets you
  (dictionary popup, mining, 復習, listening, backups) and what it does not (lessons, drills).
- Settings → Learning shows the two cards plus the same select; the select shows the language you are on.

**2. Korean (phase 2)**
- Settings → Learning → Korean. Settings → Dictionaries → **⬇ KRDICT — Korean, with English
  meanings** (~17 MB; it downloads from a GitHub release and installs like an upload).
- 読む → paste `한국어를 공부해요` → the words are clickable, **한국어를 is saved as 한국어** (the particle
  comes off), and there is a romanisation over it (hangug-eoreul). Click it: the popup shows the KRDICT
  entry, and **+ mine** works as usual.
- What a bug looks like here: a whole sentence as one word, the Japanese popup, or no marks at all.

**3. Chinese (phase 2)**
- Settings → Learning → 中文, Settings → Dictionaries → **⬇ CC-CEDICT** (~8 MB).
- 読む → paste `我愛中文，你呢？` → four words, not one, with pinyin over the Chinese ones.

**4. Coverage, priming, the plan (phase 3)**
- Switch back to Japanese, paste a real article or a chapter into 読む, read it to the end.
- The badge says the % you know; under it **learn these first** lists up to six words with a chip each
  and the jump it would give you (`61% → 78%`).
- 読む → **plan my week**: it tokenizes the library (up to 20 texts; slow the first time, by design),
  then lays out ~25-minute days — the 85–94% texts first, the ones you started before the ones you
  have not — with the words the week keeps meeting under it. Your videos, podcasts and manga volumes
  join the same week, as links, once they have a % of their own.
- Settings → Stats: **what you can read now** (texts banded 95+ / 85–94 / below, with the average) and
  **lines one word away**.

**5. Speech recognition (phase 4, machine half)**
- Settings → **speech recognition**: without a tool installed it says so and names what to install.
  That is the honest path, not a bug.
- To try it for real: install whisper.cpp (`whisper-cli`) and put a `ggml-base.bin` in
  `~/.cache/akko/whisper` (or set `AKKO_WHISPER` and `AKKO_WHISPER_MODEL`), restart akko, and
  読む → **🎙 subtitles from audio** with an `.mp3`/`.m4a`. The transcript lands in the library as a
  text, so it gets a %, priming and a place in the plan.
- A video file is not accepted on purpose: Whisper wants audio, and pulling audio out of a video
  needs ffmpeg. That is the next decision, not something to discover in a crash.

**6. The fixes after the first local test**
- Switch the interface to Português or 日本語 in Settings → Display: the plan box, "learn these first",
  the Stats bands and the speech recognition section all speak that language now.
- With the dark theme: the plan box is a dark panel with readable text (it used to be cream on cream).
- Settings → Dictionary → *add from a link*: paste a Yomitan `.zip` address for the language you are
  learning (any of the 29, from the community list) and it installs like an uploaded file.
- Paste a Japanese text while learning German: it files itself in the Japanese library and is
  tokenized as Japanese, so "learn these first" offers words, not sentences.

## Known rough edges, so they do not look like bugs

- **The interface is in en / ja / pt / es.** The language you *learn* is a different list (29); adding
  an interface language needs a full translation of ~800 strings, so it is a reviewed contribution,
  not something to machine-translate quietly.
- **German, Polish, Russian, Spanish, Italian** have no one-click pack yet — use *add from a link* (no licensed, versioned
  Yomitan release I could verify). They work through Settings → Dictionaries → **add a .zip**; word
  splitting is "space + let the dictionary take a suffix off", which is right for articles and rough
  for heavy inflection.
- **Japanese-only pages stay Japanese**: manga mode, the 表現 page, drills. A non-Japanese week never
  offers a manga volume.
- **The plan tokenizes on the button press** — a library of twenty books takes a while. Nothing is
  cached server-side yet.
- **A language without lessons** is dictionary + mining + 復習 + reader + planner. That is the design,
  not a missing feature.
- The welcome select shows the current language only when it is a non-Japanese, non-English one; with
  ja/en the card itself is highlighted.

## Where the new code is

| file | what it does |
|---|---|
| `scripts/core/target.js` | the language table, `profile`, `has`, `pagesFor`, per-language storage keys |
| `server/multilingual.js` | words for languages with no parser: longest match, Korean particles + romanisation, pinyin, suffix stripping, ICU for Thai |
| `server/packs.js` + Settings → Dictionaries | KRDICT / CC-CEDICT / CC-Canto, versioned releases, installed like an upload |
| `scripts/core/coverage.js` | the one coverage engine: %, unknown words, i+1 lines, priming |
| `scripts/core/planner.js` | the week: bands, started-before-unstarted, no repeats, leftovers |
| `server/asr.js` | finds a Whisper-class tool on this machine, runs it, returns an SRT |
| `docs/ideas-3.0.md` | the plan, with a state column and a checklist per phase |
