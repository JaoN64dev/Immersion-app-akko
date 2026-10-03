# Japanese akko

A Japanese immersion app that runs on your own computer. You can:

- **Watch** anime with Japanese subtitles (found automatically from kitsunekko.net)
- **Read** text and manga
- **Listen** to podcasts with transcripts
- Hover over any word to see its dictionary entry, kanji info and pitch accent
- Send words to **Anki** as flashcards
- Follow the **道 course**: a step-by-step path from kana to immersion, built on the AJATT idea, with goals the app checks for you. Steps are Markdown files you can edit (see [course/README.md](course/README.md))
- Study **grammar** with short lessons and quizzes. Grammar you've studied is underlined in subtitles and texts. Lessons are Markdown files you can edit or add to (see [grammar/README.md](grammar/README.md))
- **Learn Japanese or American English**: you choose on the first visit. English mode has English word lookups: definitions (WordNet) and American pronunciation (CMU Pronouncing Dictionary) work offline; translations into your own language (about 20 to choose from in Settings, from Wiktionary) and American recordings (Wikimedia Commons) need the internet once per word, then are saved. It can also search English subtitles on OpenSubtitles.com with your free API key (Settings → English subtitles), English grammar lessons (`grammar-en/`, A1–C1) and its own course (`course-en/`). Each language keeps its own words and progress. The menus are in English by default, for everyone
- **設定 Settings**: the language you learn, the interface language (**English / 日本語**, translations in `scripts/lang/ja.js`), display options, stats and backup

The dictionary works offline once it has been set up.

## Two ways to run it

akko is free and open source. You can use it either way; they're the same app.

- **Desktop app** (easiest): download **akko-setup.exe** (installer) or **akko-portable.exe** (no install) from the [Releases page](https://github.com/JaoN64dev/japaneselocalwebapp/releases) and open it. Nothing else to install: the dictionaries come inside.
  - **App window or your browser?** Each time akko starts it asks how to open: in its own **app window**, or in **your browser** (akko then runs as an icon in the system tray, next to the clock; right-click it to open akko or quit). Tick **Remember my choice** to stop the question; change it later in **akko → When akko starts**. Starting the app with `--browser` or `--window` skips the question.
- **Web server** (from the code): run it with Node.js and use it in your browser. Best if you want to change lessons or the code. See the setup below.

Your words and progress are kept separately by each one (the app window, your browser, and the web server version each have their own storage). To move them, use **Settings → Backup** in one and **Restore** in the other.

## Requirements (web server)

- [Node.js](https://nodejs.org/) **version 18 or newer** (the LTS version is recommended)
- [Git](https://git-scm.com/) to download the project (or use **Code → Download ZIP** on GitHub)
- *Optional:* [Anki](https://apps.ankiweb.net/) with the **AnkiConnect** add-on, if you want to make flashcards

To check that Node.js is installed, open a terminal and run:

```
node --version
```

## Setup

1. **Download the project**

   ```
   git clone https://github.com/JaoN64dev/japaneselocalwebapp.git
   cd japaneselocalwebapp
   ```

2. **Install the dependencies**

   ```
   npm install
   ```

3. **Start the server**

   ```
   npm start
   ```

   You should see:

   ```
   Server running at http://127.0.0.1:3000
   ```

4. **Open the app** at **http://127.0.0.1:3000** in your browser.

Keep the terminal open while you use the app. Press `Ctrl + C` in it to stop the server.

On Windows you can also double-click **start-akko.bat**: it installs what's needed the first time, starts the server and opens the browser.

## Building the desktop app

From the project folder, after `npm install`:

| Command | What it does |
|---|---|
| `npm run desktop` | opens the desktop app straight from the code (to try changes); `npm run desktop -- --browser` for the browser mode |
| `npm run dist` | builds the installers into `dist/`: `akko-setup-<version>.exe` and `akko-portable-<version>.exe` on Windows (a `.dmg` on macOS, an `.AppImage` on Linux; build each on its own system) |

The desktop app runs the same server inside the window, on port 3417, so it can run next to `npm start` (port 3000). Its server files (dictionaries, caches, OpenSubtitles login) are in your user profile (`%APPDATA%\akko\data` on Windows), reachable from **Help → Open the data folder**. Lessons and the course are built into the app; to edit them, use the web server version.

The installers aren't code-signed, so Windows SmartScreen shows "Windows protected your PC" the first time: click **More info → Run anyway**.

> Before you start watching, read the **keys** section in the app to learn the keyboard shortcuts.

## Dictionary data

The files in `data/` (dictionary, kanji and pitch accent) are already in the repository. If any of them are missing, the server downloads and builds them the first time it starts. This takes about a minute and needs an internet connection. The terminal shows the progress:

```
dictionary: … entries ready
kanji: … ready
pitch accent: … words ready
tokenizer: ready
```

Words can't be looked up until these lines appear.

## Anki (optional)

1. Install and open [Anki](https://apps.ankiweb.net/).
2. Go to **Tools → Add-ons → Get Add-ons…** and enter the code **`2055492159`** (AnkiConnect).
3. Restart Anki.

Anki must be open while you use the app. You don't need to change any AnkiConnect settings, because the app connects to it through the local server.

Cards can include a recording of the word being said. Set a field to **word audio** in the Anki panel on the Watch page. The audio comes from [JapanesePod101](https://www.japanesepod101.com/) or, if that has none, from [Lingua Libre](https://lingualibre.org/) recordings on Wikimedia Commons. Both are free, but you need an internet connection for this.

## Manga OCR (optional)

To click words in manga, the text on each page has to be read first (OCR). The app does this with [mokuro](https://github.com/kha-white/mokuro), on your own computer.

1. Install [Python](https://www.python.org/downloads/) 3.10 or newer.
2. In a terminal, run:

   ```
   pip install mokuro
   ```

   This is a big download (about 1.5–2 GB with PyTorch). The first OCR also downloads mokuro's models (about 500 MB).
3. On the **Read** page, open a manga volume and press **OCR this volume**.

Without an NVIDIA graphics card, OCR runs on the processor and takes a few seconds per page. The result is saved in `data/ocr/`, so each volume only needs it once. To use a specific Python, set `AKKO_PYTHON` to the path of its `python.exe` before starting the server.

## Optional: GitHub token

Subtitles are also searched in a GitHub mirror. Without a token, GitHub allows only 60 requests per hour. If you use the app a lot, you can raise that limit with a [personal access token](https://github.com/settings/tokens) (it doesn't need any permissions):

**Windows (PowerShell)**
```
$env:GITHUB_TOKEN = "your_token_here"
npm start
```

**macOS / Linux**
```
GITHUB_TOKEN=your_token_here npm start
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `'node' is not recognized` | Install Node.js, then open a new terminal. |
| `EADDRINUSE: address already in use :::3000` | The app (or another program) is already using port 3000. Close the other terminal, or change `port` in `server.js`. |
| `can't reach Anki` | Open Anki and check that AnkiConnect is installed. |
| Words don't show a definition | Wait until the terminal says `dictionary: … ready`. |
| `Cannot find module …` | Run `npm install` again. |

## Project structure

```
server.js        starts the local server (port 3000)
electron/        the desktop app: main.js runs the server in a window; icons
server/          the APIs: dictionary, English, grammar, course, subtitles, Anki, podcasts, OCR
scripts/         the code that runs in the browser (scripts/pages/ = one entry script per page)
*.html           the pages: watch (index), reading, podcasts, grammar, course, review, settings, about
grammar/         Japanese grammar lessons (Markdown)      grammar-en/   English grammar lessons
course/          the Japanese course (Markdown)           course-en/    the English course + translations
data/            offline dictionary files, and what the server saves (OCR, caches)
tools/           npm run check-lessons
tests/           npm test
docs/            how the code works
```

How everything fits together, step by step, is in [docs/how-it-works.md](docs/how-it-works.md).

## Data sources and licenses

The files in `data/` are **not** covered by this project's MIT license. They come from these projects and keep their own licenses:

| File | Source | License |
| --- | --- | --- |
| `data/dict.json` | [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) by the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/) (EDRDG), converted with [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `data/kanji.json` | [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) by the EDRDG | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `data/accents.txt` | [Kanjium](https://github.com/mifunetoshiro/kanjium) (pitch accent data from Wadoku) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

For English, two npm packages are used (installed into `node_modules`, not in `data/`): [WordNet 3.1](https://wordnet.princeton.edu/) (Princeton University, [WordNet licence](https://wordnet.princeton.edu/license-and-commercial-use)) for definitions, and the [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict) (Carnegie Mellon University, BSD-style licence) for American pronunciation. Translations and recordings come from [Wiktionary](https://en.wiktionary.org) and [Wikimedia Commons](https://commons.wikimedia.org) (CC BY-SA).

These files are used under the [EDRDG licence](https://www.edrdg.org/edrdg/licence.html) and the Kanjium license. If you share modified versions of them, they must stay under CC BY-SA 4.0 and keep this credit.

## Other credits

- Word splitting: [kuromoji](https://github.com/takuyaa/kuromoji.js) (Apache 2.0)
- Anime search: [AniList](https://anilist.co) API
- Anime subtitles: [kitsunekko.net](https://kitsunekko.net) and the [kitsunekko mirror](https://github.com/Ajatt-Tools/kitsunekko-mirror) on GitHub
- Film and drama subtitles: [JP-Subtitles](https://github.com/Matchoo95/JP-Subtitles) on GitHub
- Word audio: [JapanesePod101](https://www.japanesepod101.com/) and [Lingua Libre](https://lingualibre.org/) (Wikimedia Commons)

The app fetches subtitles and word audio from these sites while you use it. It doesn't include any of their files, and it may stop working if they change.

## License

The code is released under the [MIT License](LICENSE). The dictionary data in `data/` has its own licenses (see above).
