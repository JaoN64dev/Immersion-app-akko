# Maintaining akko

Everything a version needs, from the code to the release. How akko works inside is in
[`how-it-works.md`](how-it-works.md); this page is the routine.

## Before a version

1. **The tests, on every system**: `.github/workflows/build.yml` runs `npm test` on Windows, macOS
   and Linux for every push (Node 22.13 or newer: `engines` in `package.json` — the server uses
   `node:sqlite`). Locally:
   ```
   npm ci
   npm test             # 23 files, about 25 s on Linux
   npm run check-lessons
   ```
   Two tests skip themselves when the system can't do them: Windows' Japanese voice, and
   VOICEVOX's installer (it unpacks with Windows' `tar`).
2. **In a browser**, the things no test covers: a video with Japanese subtitles (click a word, mine
   it, `1`–`4` on it), a book or manga page, a podcast episode, a listening drill (a line spoken by
   VOICEVOX and by the computer's voice), the grammar lessons and their quiz, 復習 in all three
   card types (`M`), the expressions page (a set, the search, one you've met), Settings → Backup
   (**download everything (.zip)**, then restore it and check a mined word still has its picture and
   line), the phone (`akko.html` on the home network), and the extension on YouTube / Netflix.
3. **Versions**: `package.json` → `version`, `extension/manifest.json` → its own version (the
   extension's zip is named from it, `tools/pack-extension.js`). They move separately: the app is
   2.0.0, the first published extension is 1.0.0.
4. **The docs of a feature**: `README.md`, the in-app About page (`about.html`), `how-it-works.md`
   for whoever changes the code, and the website (`website/`, see below).

## The release

```
git tag 2.0.0
git push origin 2.0.0
```

That starts the **build** workflow: the tests on the three systems, then `npm run dist` on each
(Windows `nsis` + `portable`, macOS `.dmg` and `.zip`, Linux `.AppImage`, plus the extension's
`.zip`), and everything lands in a **draft release**. Paste the notes (they're in `docs/` for the
big ones, e.g. `release-2.0.md`), check the files, publish.

What an update needs in the release, besides the installers: `latest.yml` (Windows) and its
`.blockmap`, `latest-linux.yml` (AppImage). Without them the app's update check only opens the
download page — which is what happens on macOS anyway (below).

Nothing is code-signed (a certificate costs money), so the first install warns: Windows'
"Windows protected your PC" → *More info* → *Run anyway*, macOS' "can't be opened" → right-click →
*Open*. `README.md` says so.

## Who can update itself

- **Windows** (installer): yes, `electron-updater` downloads it and installs on restart
  (`electron/main.js`, `installUpdate`).
- **Linux** (AppImage): yes; the AppImage replaces itself. A copy run from a folder, or a distro's
  package, opens the download page instead.
- **macOS**: no. Squirrel.Mac only installs an update signed with the same Developer ID as the
  running app, and these builds are unsigned, so akko opens the download page (the dialog says
  why). Enabling it means an Apple Developer account ($99 a year), a Developer ID certificate and
  notarisation in `build.yml` — then drop the `darwin` exception in `canInstall`.

The update check itself (is there a newer version?) is akko's own: `UPDATE_URL` in
`electron/main.js`, the newest GitHub release.

## The website

`website/` is published by the **website** workflow on GitHub Pages when it changes on `main1`
(once: Settings → Pages → Source: *GitHub Actions*). The page is written in English and translated
in `website/i18n/{pt,es,ja}.json`: **the keys are the English sentences**, so a new sentence needs
an entry in all three files or it stays English. `website/main.js` picks the visitor's language.

## The online service (`cloud/`)

Only needed for akko accounts and reports from inside the app. `cloud/README.md` has the steps
once: a Cloudflare account, the D1 database and R2 bucket, the `GITHUB_TOKEN` secret for issues,
the three Actions secrets, then the **cloud** workflow deploys on every change in `cloud/`. The
service's address goes in `package.json`:

```json
"akko": { "cloud": "https://akko-cloud.<you>.workers.dev" }
```

Until it's there, Settings hides *akko account* and a report opens a pre-filled GitHub issue
instead (`server/cloud.js`, `server/diagnostics.js`). `AKKO_CLOUD=<address>` does the same for a
build you run from the code.

## The browser extension

`npm run pack-extension` (and `npm run dist`) makes `dist/akko-companion-<version>.zip`; the
installed app carries `extension/` too (`build.extraResources`). People load it unpacked, or from
the Chrome Web Store once it's published.

The extension's id comes from the `key` in `extension/manifest.json`, so unpacked copies all have
`cflgdipimeohhbeadldfgaohdcnnkcol`. A **store** copy has a different id: add it to the `Set` in
`server/guard.js` (or to `AKKO_EXTENSIONS`, a comma-separated list). Nothing else lets another
extension talk to akko's server.

## What a build has to contain

`package.json` → `build.files` says what goes in the installer: everything except `data/` (only
`dict.json`, `kanji.json`, `accents.txt` — the dictionaries; the rest of `data/` is the person's
word list, backups, caches), `tests/`, `tools/`, `docs/`, `website/`, `cloud/`, `.github/`,
`extension/` (it's in `extraResources` instead), and the parts of ffmpeg and WordNet that akko
never loads. Check a built installer before publishing: `data/` has those three files and no
`words.json`, `cloud.json` or `sync/`.

`electronLanguages` keeps Chromium's own texts in English, Portuguese, Spanish and Japanese only.

## The data akko makes (never commit it)

`data/` (the word list, sync state, logins, backups, `expressions.json`, `dict/` for added
Yomitan dictionaries), `dist/`, `cloud-local/`. `.gitignore` covers them; only `data/dict.json`,
`data/kanji.json` and `data/accents.txt` are in the repository.

## Adding things

`docs/how-it-works.md` → *How to…* has the recipes (a page, an API, interface text, a grammar
lesson, something new saved in the browser). Two more, for this file's topics:

- **A new interface language**: a table in `scripts/lang/` with the same keys as `ja.js`
  (`tests/i18n.test.mjs` checks that), add it to `TABLES` in `scripts/i18n.js` and to
  `LANGUAGES` (the Settings switch), and to `electronLanguages` if Chromium's texts should follow.
- **A new backup field**: it's either an `akko-*` localStorage key (`scripts/core/utils.js`, the
  `store`) or an IndexedDB store (`scripts/core/idb.js` — add it to `IDB_STORES` if backups should
  carry it, and to the `.zip` only if it's a Blob).
