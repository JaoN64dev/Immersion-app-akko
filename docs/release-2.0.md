# akko 2.0

The biggest akko so far: idioms get their own page, the interface speaks four languages, 復習 asks
in three ways, a backup can keep your recordings, and your computers can finally stay in step.

## 表現 Expressions

An idiom isn't the sum of its words: 首を長くする is *to wait eagerly*, not a long neck. akko has
underlined the ones it found while you watched and read for a while — now they have a page.

- **The ones you've met**, newest first, with the sentence you met them in and where it came from
  (the episode, the book, the time).
- **Every expression JMdict knows**: 13,159 of them — 慣用句, ことわざ, 四字熟語 and everyday phrases —
  with readings and meanings, searchable, and sorted into sets, including the ones with
  手・口・目・腹・頭・足.
- **Expression of the day** on the welcome screen.

Expressions keep their own status, apart from your words, and the popup still shows the whole idiom
when you click one of its words.

## Four interface languages

English, 日本語, Português and Español — for the pages *and* the browser extension, each remembering
its own choice. Settings that arrive from another computer now apply straight away, without a
reload.

## 復習, your way

A card can ask with the word alone, as a **cloze** (the word hidden in its sentence, the picture left
for the answer) or with **the line first** (hear it, then the word). `M` switches while you review;
a card without a sentence or a recording simply asks with its word. Everything else is unchanged:
FSRS scheduling, the scene and the line, known/learning/ignored, the keys.

## A backup with everything

Settings → Backup → **download everything (.zip)** now keeps what the plain `.json` couldn't: the
line audio and pictures of your mined words. Restoring takes either one — the `.zip` replaces the
recordings too, a `.json` leaves them where they are. Automatic backups stay small and text-only.

## Your computers in step

An **akko account** (optional, free) keeps your words, positions, 復習, mined words and their
recordings the same on every computer, phone and browser. Nothing leaves your computer without one,
and what it keeps is listed next to sign-up, downloadable, and deleted with the account. The website
now has a privacy notice that says exactly this.

## Under the hood

- The tests run on Windows, macOS and Linux for every push; dependencies are pinned by exact
  version; Node 22.13 or newer is required and declared.
- Linux AppImages update themselves now, and the Mac build ships the `.zip` the update feed needs
  (a Mac can't install an update by itself until the app is signed; it opens the download page).
- New `docs/maintaining.md`: how to test, tag and release akko, what the workflows need, what a
  build must contain.
- New on the website: expressions, review card types, accounts, and the privacy notice — in English,
  Português, Español and 日本語.

## Fixes

- 聴解's *YouTube JLPT sample test* card no longer opens an N3 playlist whatever your level is: N5,
  N4 and N3 each have their own, and the card follows the level you picked. N2 and N1 don't show it,
  because there's no playlist for them we've checked — the jlpt.jp card above it has all five.
- A backup `.zip` checks each file's checksum as it's restored: a damaged download is refused with
  "… in this zip is damaged" instead of putting half a word list back.

## Updating

Install over your old akko: words, progress, books and mined words are kept (back up first if you
like). The extension is now 1.0.0: reload it in `chrome://extensions`, or install
`akko-companion-1.0.0.zip`.
