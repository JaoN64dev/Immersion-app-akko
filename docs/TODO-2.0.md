# akko 2.0: what's left

Checked against the code on 2026-11-02 (`npm test`: 99 tests, 97 pass, 2 skipped — the two that need
Windows' Japanese voice and VOICEVOX's Windows installer).

## Done in this pass

- [x] **Expressions page** (`expressions.html`): the ones you've met with the sentence and source
      (`akko-expressions` now keeps `{at, sentence, source, time}`; mined expressions get them from
      their card), and every 慣用句・ことわざ・四字熟語・phrase JMdict knows — 13,159 of them, with the
      sets from its tags and 手・口・目・腹・頭・足 (`/api/expressions`, `/api/expressions/today` in
      `server/dictionary.js`). Expression of the day on the welcome screen. All interface text in
      the four languages.
- [x] **Complete backup (.zip) with recordings**: Settings → Backup → *download everything (.zip)*
      (`scripts/core/zip.js`, `buildBackupZip` / `readBackupFile` in `core/backup-file.js`): the
      JSON plus `media.json` and the line audio and pictures. Restoring takes either file; a plain
      `.json` leaves the recordings alone. Tested in `tests/zip.test.mjs`.
- [x] **Cloze and line-first cards in 復習**: the switch above the card, or `M`; a card with no
      sentence or no recording falls back to the word (`akko-review-mode`).
- [x] **Built to last**:
  - [x] `npm test` on Windows, macOS and Linux (`build.yml`), `engines.node >= 22.13`.
  - [x] Pinned dependencies: exact versions in `package.json`, lockfile and `npm ci`.
  - [x] electron-updater on Linux (the AppImage replaces itself) and `latest-linux.yml`, plus the
        Mac `.zip` for the update feed. **macOS still can't update itself**: Squirrel.Mac only
        installs an update signed with the same Developer ID as the running app, and akko's builds
        are unsigned — it opens the download page and says why. Enabling it needs a paid Apple
        Developer account; the steps are in `docs/maintaining.md`.
  - [x] `docs/maintaining.md`: the routine (tests, versions, tag, the workflows and their secrets,
        what a build must contain, the extension's store id, the cloud service).
- [x] Settings that arrive by sync now apply in the same tab (`scripts/i18n.js`, `akko-saved`).
- [x] The interface tables can't drift again: `tests/i18n.test.mjs` now fails if a language file
      has anything besides `text` and `html` (a translation added outside them is never used) and
      if the four tables' keys differ.
- [x] The welcome screen's last line names all four interface languages.
- [x] The extension's options page counts both word lists.
- [x] Docs: README (expressions, four interface languages, card types, the `.zip` backup, sync),
      the in-app About page, `how-it-works.md` (the expressions page, the card types, the zip, all
      23 test files, the multi-system CI, the updater), the website (three new cards, the privacy
      notice, and the changed text in pt / es / ja).
- [x] Versions: `package.json` → 2.0.0, `extension/manifest.json` → 1.0.0.

## Needs the maintainer (once, with accounts akko can't make by itself)

- [ ] **Turn on akko accounts and online reports**: a free Cloudflare account, the D1 database and
      R2 bucket, the GitHub token secret, and the three GitHub Actions secrets
      (`cloud/README.md` → *Setting it up*). The **cloud** workflow then deploys the service; until
      then it prints a warning and stops.
- [ ] Put the service's address in `package.json`: `"akko": { "cloud": "https://akko-cloud.<you>.workers.dev" }`.
      Until then Settings hides *akko account* and reports open a pre-filled GitHub issue instead.
- [ ] **Chrome Web Store**: a developer account ($5 once), then publish `dist/akko-companion-1.0.0.zip`
      and add the store's id to `server/guard.js` (or `AKKO_EXTENSIONS`).
- [ ] Optional: sign the Mac build (Apple Developer, $99 a year) so it can update itself; the steps
      are in `docs/maintaining.md`.

## The release

- [x] Versions, docs, website, the release notes (`docs/release-2.0.md`).
- [ ] `npm run dist` on Windows (or let the **build** workflow do all three), check the installer's
      `data/` has only the three dictionary files (no `words.json`, `cloud.json`, `sync/`), install
      over 1.9, then `git tag v2.0.0 && git push origin v2.0.0`: the workflow drafts the release.
- [ ] Rarely (about 1 in 15 full runs on Windows) a test file dies on exit with
      `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`: a Node / libuv issue, not akko's.
      Not seen on Linux, Node 22.22.
