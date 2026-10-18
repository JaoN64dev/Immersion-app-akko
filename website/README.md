# akko's website

The one-page site that presents akko and links to the downloads. Plain HTML, CSS and a little
JavaScript: no build step.

| File | What it is |
|---|---|
| `index.html` | the page: features, screenshots, YouTube & Netflix (the extension), downloads, resources, questions |
| `style.css` | the look (the app's colours; light and dark follow the visitor's computer) |
| `main.js` | shows the page in the visitor's language (see [Languages](#languages)), and points the download buttons at the newest release's files, using GitHub's API |
| `i18n/` | the page in Portuguese, Spanish and Japanese |
| `images/` | screenshots of akko, the icon, the dots |

**The download buttons update themselves**: they ask GitHub for the latest release and link its
`akko-setup-…exe`, `akko-portable-…exe` and `akko-companion-…zip`. Publishing a release is enough; this page doesn't
need editing. Without an answer from GitHub, they link the releases page.

## Seeing it

Open `index.html` in a browser.

## Putting it online (GitHub Pages, free)

1. Push this folder and `.github/workflows/website.yml`.
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The **website** action publishes it, then again whenever something in `website/` changes.

It's then at **https://jaon64dev.github.io/Immersion-app-akko/**.

To use your own domain instead, add it in Settings → Pages → Custom domain.

## Screenshots

Most show the public-domain novel 吾輩は猫である and akko's own lessons and drills. Three are
frames from other people's videos: `watch.jpg` and `image.png` (an anime episode) and
`extension.jpg` (a YouTube video). Frames and covers from shows are copyrighted, so it's safer to
replace those with videos you're allowed to show (your own, or Creative Commons ones). `image.png`
is also big (830 KB): a JPEG would be about a tenth of that. To retake screenshots, use a copy of
akko with sample data (not your own), at 1280×800, saved as JPEG.

## Languages

Someone who wants to learn English may not read English yet, so the page shows itself in the
visitor's language: **Portuguese, Spanish or Japanese** (the languages akko's own lessons and course
are translated into), picked from the browser's languages, or from the menu in the top bar (the
choice is remembered). Any other browser language gets English and a "🌐 <language>" link to
Google Translate's copy of the page (only a link: there's no script of Google's on this site).

- `i18n/pt.json`, `i18n/es.json`, `i18n/ja.json` map each block of the English page (a heading,
  a paragraph, a list item…, as its HTML) to its translation, plus a few `@…` texts that `main.js`
  writes itself (the download buttons, the release line, the page title).
- A block that's changed in `index.html` simply stays in English until its translation is updated:
  nothing breaks. Copy the block's new HTML as the key and translate it; keep its links the same.
- Names of things inside akko (Settings → Backup, the Listen tab…) stay in English in the
  translations, because that's what the app shows.
- Opened straight from the folder (`file://`), the page stays in English: browsers don't let it
  read the translation files. Use any local server, or the published site.
