# akko companion (Chrome extension)

akko's clickable subtitles on **YouTube**, **Netflix** and **any other video site** (with a subtitle file you bring), for **Japanese** and **English**: hover or click a word to get akko's dictionary, mark it new / learning / known / ignored, and mine it to Anki with the sentence, the translation, the line's audio and a screenshot. Idioms and set phrases (膝が笑う, 首を長くする, give up, under the weather) are underlined, and the popup explains them as a whole.

Its menus follow akko's interface language: English, 日本語, Português or Español.

It uses **your akko**: the dictionary, word splitting, word audio and Anki all go through the akko app running on your computer, and what you do while watching goes back into akko. akko has to be open while you watch.

## Install

1. Get the folder: in akko, **Settings → YouTube and Netflix → open the extension folder** (it comes with the desktop app), or unzip `akko-companion-<version>.zip` from akko's [releases](https://github.com/JaoN64dev/Immersion-app-akko/releases/latest), or use this `extension` folder.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the folder. Keep it where it is: Chrome uses it from there.
4. Have akko open (the desktop app, or `npm start`). The extension finds it by itself; akko's **Settings → YouTube and Netflix** says when it's connected.

The extension always has the id `cflgdipimeohhbeadldfgaohdcnnkcol`, and akko only lets that id use its API. If you load a copy with a different id, start akko with `AKKO_EXTENSIONS=<id>`.

After updating the extension (or clicking reload in `chrome://extensions`), reload the YouTube / Netflix tabs that were already open.

## Requirements

- akko 2.0 or newer, open (1.8 and 1.9 work for Japanese). The extension looks for it at 127.0.0.1 / localhost on ports 3417 and 3000; set a different address in the options page.
- For mining to Anki: Anki with AnkiConnect. akko passes the cards on, so AnkiConnect needs no extra setup. The deck, note type and fields come from akko's own Anki settings; you can also set them in the options page.

## Using it

**What you learn**: in the toolbar popup, **I'm learning**: what akko is learning (the default: it follows akko's own choice), Japanese, English, or both. On a YouTube video or a Netflix title with subtitles in that language (made by people, or YouTube's automatic ones), akko's subtitles replace the site's own. Your words, mined cards and the time you watch go to that language's list in akko. On YouTube, English subtitles on a video spoken in another language are a translation, not English to learn, so they're left alone.

For English: no furigana; the popup shows the word's pronunciation (IPA), its translation into your language (akko's **your language** setting) and its English definitions; grammar links go to akko's English lessons. The **akko ▾** pill (top right of the video) shows how much of the video you know, and opens the settings:

Click a word for akko's dictionary: its meanings, 🔊 its pronunciation, its pitch accent, how it's conjugated (見てみてください = 見る + て-form + 〜てみる + 〜てください), its kanji, and the grammar it's part of, linked to akko's lesson. If the word is part of an idiom (膝が笑ってしまった), the idiom comes first, with its own status and **+ mine** (the card has the whole idiom in bold).

**☰** (or `Shift+T`) lists every line of the video: click a line to go there, or a word to look it up (and mine it with that line as the sentence). Lines with exactly one word you don't know yet get a **★**: those make the best cards ("i+1"); tick "only ★" to see just those.

- **Subtitles:** which track (in the language you learn); the translation (the video's own subtitles in another language, or YouTube's translation) and when it shows: when paused, always, always but blurred until the mouse is on it, or never; furigana on all words, unknown words only, or none; the ★ on i+1 lines; the timing, when the subtitles come early or late
- **Watching:** pause when the mouse is on the subtitles; pause at the end of every line; listening practice (the subtitles stay blurred while they play: listen first, then pause or hover to read)
- **Look:** size, height, background, font (gothic, mincho, rounded)
- **Mining:** "+ mine" sends the card to Anki and akko's mined list, or only to akko (send it to Anki later from akko's Watch page); the line's audio and a picture are kept in akko too, for 復習 (a switch turns that off)
- turning akko off for that site

| Key | |
|---|---|
| `1` `2` `3` `4` | mark the hovered or open word new / learning / known / ignored |
| `[` `]` | previous / next line |
| `p` | replay the line |
| `Shift`+`P` | replay the line slowly |
| `Shift`+`T` | every line of the video |
| `a` | pause at the end of every line, on / off |
| `l` | listening practice, on / off |
| `r` | how the translation shows (when paused → always → blurred → never) |
| `Esc` | close the word popup (or the list of lines) |

## Any other site

On a site with a video that isn't YouTube or Netflix (Crunchyroll, Disney+, a course site, a video you host…), click the **akko companion** button in Chrome's toolbar, then **▶ Use akko on this page**. Drop a subtitle file on the video, or pick one (.srt, .vtt or .ass): a file in the language you learn becomes akko's clickable subtitles, a file in another language the translation (drop both). Everything else works as on YouTube: the dictionary, ☰ the lines, ★, mining, the keys and the timing buttons (subtitle files often come a little early or late).

- The line's audio and the picture come from the tab, so they work even on copy-protected video. The click on the toolbar button is what allows that.
- If the video is inside a frame from another address (Crunchyroll's player is), the popup says so and asks your permission for that address, once.
- Chrome's own pages and the Chrome Web Store can't be used.

## Netflix

On Netflix, the subtitles come either from the title's subtitle list or, if Netflix doesn't send that, from the subtitle file its player downloads: turn on Japanese (or English) in Netflix's own subtitle menu and akko's subtitles take over. Switch Netflix's menu to another language for a moment to get that one as the translation.

## With akko

The extension and akko keep in step through akko itself (its server), so it works with akko's desktop app; nothing needs to be open in the browser:

- akko → extension: your Japanese word list, Anki settings and language (for the translation)
- extension → akko: the words you mark (straight into akko's one word list, shared by the desktop app, your browsers and your phone); the words you mine (they appear in akko's mined list, in Stats, and in 復習 with the sentence they came from, the scene and the line's audio); the time you watch, which counts for today and your streak, with the videos listed in Stats

If akko is closed, these wait in the extension and go when it's back.

## Limits

- **YouTube:** the subtitles are the ones YouTube's own player downloads, so the player must be able to show them. If a video says "YouTube didn't send the subtitles", play it for a moment and reload. During ads, akko's subtitles step aside and come back after.
- **Netflix is experimental:** Netflix changes its player from time to time. Its video is copy-protected, so the line's audio and the picture for cards are taken from the whole tab instead, and Chrome only allows that after you **click the akko companion button in the toolbar once on that tab**. If the picture comes out black, turn off "Use graphics acceleration when available" in Chrome's settings. Titles whose Japanese subtitles are only pictures can't be read.
- Using the extension on Netflix may go against Netflix's terms of use. It only reads the subtitles your account is already sending to your browser. Use it at your own discretion.
- If akko runs both as the desktop app and in a browser tab, each has its own word list (as before); both get what the extension sends.

## For developers

How the pieces fit (the scripts in YouTube's and Netflix's pages, the overlay, the background worker, recording, keeping in step with akko) is in akko's [docs/how-it-works.md](../docs/how-it-works.md#the-browser-extension-youtube-and-netflix).

- After changing a file, click the reload arrow on akko companion in `chrome://extensions`, then reload the YouTube / Netflix tab.
- `npm run pack-extension` (in akko's folder) makes `dist/akko-companion-<version>.zip`, from the version in `manifest.json`; `npm run dist` does it too.
- The `key` in `manifest.json` fixes the extension's id, which akko's server allows (`server/guard.js`). Don't remove it, or akko will refuse the extension.
