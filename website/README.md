# akko's website

The one-page site that presents akko and links to the downloads. Plain HTML, CSS and a little
JavaScript: no build step.

| File | What it is |
|---|---|
| `index.html` | the page: features, screenshots, downloads, resources, questions |
| `style.css` | the look (the app's colours; light and dark follow the visitor's computer) |
| `main.js` | points the download buttons at the newest release's files, using GitHub's API |
| `images/` | screenshots of akko, the icon, the dots |

**The download buttons update themselves**: they ask GitHub for the latest release and link its
`akko-setup-…exe` and `akko-portable-…exe`. Publishing a release is enough; this page doesn't
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

They show the public-domain novel 吾輩は猫である and akko's own lessons and drills, not anime:
frames and covers from shows are copyrighted and shouldn't be on a public page. To retake them,
use a copy of akko with sample data (not your own), at 1280×800, saved as JPEG.
