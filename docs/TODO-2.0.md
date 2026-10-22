# akko 2.0: what's left

Done (committed): expressions, the interface in Portuguese and Spanish, the extension for English
learners and in four languages, the welcome tour / diagnostics / reporting a problem, everything in
step between windows / browsers / phones, and akko accounts (the online service in `cloud/`).

## Needs the maintainer (once)

- [ ] **Turn on akko accounts and online reports**: create a free Cloudflare account, the D1 database
      and R2 bucket, the GitHub token secret, and the three GitHub Actions secrets
      (`cloud/README.md` → *Setting it up*). The **cloud** workflow then deploys the service.
- [ ] Put the service's address in `package.json`: `"akko": { "cloud": "https://akko-cloud.<you>.workers.dev" }`.
      Until then Settings hides *akko account*, and reports open a pre-filled GitHub issue instead.
- [ ] **Chrome Web Store**: a developer account ($5 once), then publish `dist/akko-companion-<version>.zip`.
      Add the store's extension id to `server/guard.js` (it differs from the unpacked id
      `cflgdipimeohhbeadldfgaohdcnnkcol`).

## Still to build (the ★ extras of the 2.0 plan)

- [ ] **Expressions page** (`expressions.html`): the idioms met (`akko-expressions`), with their sentence
      and source; browsable sets from JMdict's tags (body-part idioms 手・口・目・腹・頭・足, ことわざ,
      四字熟語); an "expression of the day" on the welcome screen.
- [ ] **Complete backup (.zip) with recordings**: today's backup is JSON without the `media` store; a zip
      with the line audio and pictures, restorable.
- [ ] **Sentence and listening cards in 復習**: cloze (the word hidden in its sentence) and audio-first
      (play the line, then reveal), from the recordings kept in akko.
- [ ] **Built to last**: CI running `npm test` on Windows / macOS / Linux on every push (Node 22.5+ for
      `node:sqlite`); electron-updater for the Mac / Linux apps; pinned dependencies; a
      "maintaining akko" page in `docs/`.

## Small things noticed on the way

- [ ] Settings that arrive by sync (your language, the interface's) only show after the page reloads:
      `scripts/i18n.js` could re-apply when `akko-settings` changes in the same tab.
- [ ] Translate the welcome screen's last line ("The menus can be shown in 日本語 there too") to mention
      all four languages.
- [ ] The extension's popup "words" line and options page only count the Japanese list in one place
      (`extension/options.js` `showWords`).
- [ ] Rarely (about 1 in 15 full runs on Windows) a test file dies on exit with
      `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`: a Node / libuv issue, not akko's; watch
      it on a newer Node.

## The release (2.0.0, extension 1.0.0)

- [ ] Versions: `package.json` → 2.0.0, `extension/manifest.json` → 1.0.0.
- [ ] Docs: README (expressions, languages, sync, accounts), `extension/README.md` (done), the
      in-app About page.
- [ ] Website: the 2.0 features in English, plus the pt / es / ja copies (`website/i18n/*.json`),
      and the privacy notice.
- [ ] Release notes, `npm run dist`, check the installer's `data/` has only the three dictionary files
      (no `words.json`, `cloud.json`, `sync/`), install over 1.9, tag `v2.0.0` (the build workflow
      makes the Mac / Linux apps).
