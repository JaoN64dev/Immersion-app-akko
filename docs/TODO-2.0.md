# akko 2.0: what's left

Checked against the code on 2026-11-02 (`npm test`: 90 pass, 2 skipped, on Linux / Node 22.22).
Nothing is checked off here that isn't in the tree: the boxes say what the code actually does.

Already in: expressions (detection, `akko-expressions`, the idiom tile in Stats), the interface in
Portuguese and Spanish, the extension for English learners and in four languages, the welcome tour /
diagnostics / reporting a problem, everything in step between windows / browsers / phones
(`scripts/core/sync.js`, `server/sync.js`), and akko accounts (`cloud/`, `server/cloud.js`,
`scripts/pages/account.js`).

## Needs the maintainer (once)

- [ ] **Turn on akko accounts and online reports**: create a free Cloudflare account, the D1 database
      and R2 bucket, the GitHub token secret, and the three GitHub Actions secrets
      (`cloud/README.md` → *Setting it up*). The **cloud** workflow then deploys the service.
      Until then it prints a warning and stops (`cloud.yml`).
- [ ] Put the service's address in `package.json`: `"akko": { "cloud": "https://akko-cloud.<you>.workers.dev" }`.
      Today there's no `akko` key, so `cloudUrl()` is empty and Settings hides *akko account*; reports
      open a pre-filled GitHub issue instead (`server/diagnostics.js`, `server/cloud.js`).
- [ ] **Chrome Web Store**: a developer account ($5 once), then publish `dist/akko-companion-<version>.zip`.
      `guard.js` only knows the unpacked id (`cflgdipimeohhbeadldfgaohdcnnkcol`); it does read extra ids
      from `AKKO_EXTENSIONS`, but nothing in the app sets that, so the store's id has to go in the `Set`.

## Still to build (the ★ extras of the 2.0 plan)

- [ ] **Expressions page** (`expressions.html`): started only as far as detection. `server/expressions.js`
      finds idioms in a line and `scripts/words/render.js` keeps their statuses in `akko-expressions`
      (per language, synced), and `scripts/pages/stats.js` already counts "idioms known of N met" —
      but there's no page, no route, and no browsable sets. Wanted: the idioms met with their sentence
      and source; sets from JMdict's tags (body-part idioms 手・口・目・腹・頭・足, ことわざ, 四字熟語);
      an "expression of the day" on the welcome screen (`scripts/site.js`).
- [ ] **Complete backup (.zip) with recordings**: still a `.json` without the `media` store, on purpose
      (`scripts/core/idb.js` says so, `scripts/core/backup-file.js` skips it). Wanted: a zip with the
      line audio and pictures, restorable through the same Settings → Backup flow
      (`scripts/backup.js`, `scripts/core/auto-backup.js`, `server/backups.js`).
- [ ] **Sentence and listening cards in 復習**: the page has the pieces — `mediaOf()` gives the mined
      word its picture and line audio and `sentenceHtml()` shows the sentence with the word in
      `<mark>` — but every card is still word-first, and the audio is only a "▶ the line" button.
      Wanted: cloze (the word hidden in its sentence) and audio-first (play the line, then reveal).
      Needs a setting or a per-card type in `scripts/pages/review.js` (+ `akko-review` data).
- [ ] **Built to last**:
  - [ ] CI: `build.yml`'s `test` job is one `ubuntu-latest`, Node 22 (so 22.5+ in practice, since
        `node:sqlite` is used — but nothing declares it: no `engines` in `package.json`). Wanted:
        `npm test` on Windows / macOS / Linux on every push, and `engines.node`.
  - [ ] electron-updater on Mac and Linux: `installUpdate()` is gated by
        `canInstall = isPackaged && process.platform === 'win32' && !PORTABLE_EXECUTABLE_DIR`
        (`electron/main.js`); elsewhere "Update" just opens the release page. Wanted: `latest-mac.yml`
        / `latest-linux.yml` working, or say clearly in the docs that only Windows updates itself.
  - [ ] Pinned dependencies: every range in `package.json` is `^…`; the lockfile is committed and CI
        uses `npm ci`, so today's builds are reproducible — but a fresh `npm install` floats.
  - [ ] A "maintaining akko" page in `docs/`: `docs/how-it-works.md` has *How to…* for pages, APIs,
        interface text and storage, but nothing on cutting a release, the workflows and their secrets,
        or what to check before a version.

## Small things noticed on the way

- [ ] Settings that arrive by sync (your language, the interface's) only show after a reload:
      `scripts/i18n.js` listens to `storage` (another tab) but nothing re-applies on the same tab's
      `akko-settings` change.
- [ ] The welcome screen's last line still says only 日本語
      (`scripts/site.js`: "The menus can be shown in 日本語 there too.") — it should name all four
      interface languages, and the three translations (`scripts/lang/{pt,es,ja}.js`) follow.
- [ ] The extension's options page counts only the Japanese list (`extension/options.js`
      `showWords` reads `words`, never `wordsEn`) — the popup already counts both
      (`extension/popup.js`), so this one is half done.
- [ ] README is behind the app: no word on expressions, and it still says the interface language is
      "English / 日本語" (line 21) although Portuguese and Spanish are there too. `about.html` says
      nothing about 2.0 either.
- [ ] `docs/how-it-works.md`'s *Tests* table lists 11 files; `tests/` has 20 (missing: cloud,
      cloud-sync, diagnostics, dictionary-install, expressions, extension-lang, i18n, sync, syntax,
      yomitan).
- [ ] Rarely (about 1 in 15 full runs on Windows) a test file dies on exit with
      `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`: a Node / libuv issue, not akko's; watch
      it on a newer Node. (Not seen on Linux, Node 22.22.)

## The release (2.0.0, extension 1.0.0)

- [ ] Versions: `package.json` → 2.0.0 (now 1.9.0), `extension/manifest.json` → 1.0.0 (now 0.4.0).
- [ ] Docs: README (expressions, the four interface languages, sync, accounts) — `extension/README.md`
      is done — and the in-app About page.
- [ ] Website: the 2.0 features in English (`website/index.html`, `website/main.js`), plus the pt / es /
      ja copies (`website/i18n/*.json`, keyed by the English strings, so every new sentence needs three
      translations), and the privacy notice — today the site has neither the account/sync section nor
      any privacy text.
- [ ] Release notes, `npm run dist`, check the installer's `data/` has only the three dictionary files
      (no `words.json`, `cloud.json`, `sync/`), install over 1.9, tag `v2.0.0` (the build workflow
      makes the Mac / Linux apps).
