# akko companion (Chrome extension)

akko's clickable subtitles on **YouTube** and **Netflix**: hover or click a word to get akko's dictionary, mark it new / learning / known / ignored, and mine it to Anki with the sentence, the translation, the line's audio and a screenshot.

It uses **your akko**: the dictionary, word splitting, word audio and Anki all go through the akko app running on your computer, and what you do while watching goes back into akko. akko has to be open while you watch.

## Install

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `extension` folder.
4. Have akko open (the desktop app, or `npm start`). The extension finds it by itself; akko's **Settings → YouTube and Netflix** says when it's connected.

The extension always has the id `cflgdipimeohhbeadldfgaohdcnnkcol`, and akko only lets that id use its API. If you load a copy with a different id, start akko with `AKKO_EXTENSIONS=<id>`.

After updating the extension (or clicking reload in `chrome://extensions`), reload the YouTube / Netflix tabs that were already open.

## Requirements

- akko, open: a version newer than 1.7.0. The extension looks for it at 127.0.0.1 / localhost on ports 3417 and 3000; set a different address in the options page.
- For mining to Anki: Anki with AnkiConnect. akko passes the cards on, so AnkiConnect needs no extra setup. The deck, note type and fields come from akko's own Anki settings; you can also set them in the options page.

## Using it

On a YouTube video with Japanese subtitles (made by people, or YouTube's automatic ones), or a Netflix title with Japanese subtitles, akko's subtitles replace the site's own. The **akko ▾** pill (top right of the video) shows how much of the video you know, and opens the settings:

- **Subtitles:** which Japanese track; the translation (the video's own subtitles in another language, or YouTube's translation) and when it shows: when paused, always, always but blurred until the mouse is on it, or never; furigana on all words, unknown words only, or none
- **Watching:** pause when the mouse is on the subtitles; pause at the end of every line; listening practice (the Japanese stays blurred while it plays: listen first, then pause or hover to read)
- **Look:** size, height, background, font (gothic, mincho, rounded)
- **Mining:** "+ mine" sends the card to Anki and akko's mined list, or only to akko (send it to Anki later from akko's Watch page)
- turning akko off for that site

| Key | |
|---|---|
| `1` `2` `3` `4` | mark the hovered or open word new / learning / known / ignored |
| `[` `]` | previous / next line |
| `p` | replay the line |
| `a` | pause at the end of every line, on / off |
| `l` | listening practice, on / off |
| `r` | how the translation shows (when paused → always → blurred → never) |
| `Esc` | close the word popup |

On Netflix, Japanese subtitles come either from the title's subtitle list or, if Netflix doesn't send that, from the subtitle file its player downloads: turn on Japanese in Netflix's own subtitle menu and akko's subtitles take over. Switch Netflix's menu to another language for a moment to get that one as the translation.

## With akko

The extension and akko keep in step through akko itself (its server), so it works with akko's desktop app; nothing needs to be open in the browser:

- akko → extension: your Japanese word list, Anki settings and language (for the translation)
- extension → akko: the words you mark; the words you mine (they appear in akko's mined list, in Stats, and in 復習 with the sentence they came from); the time you watch, which counts for today and your streak, with the videos listed in Stats

If akko is closed, these wait in the extension and go when it's back.

## Limits

- **YouTube:** the subtitles are the ones YouTube's own player downloads, so the player must be able to show them. If a video says "YouTube didn't send the subtitles", play it for a moment and reload.
- **Netflix is experimental:** Netflix changes its player from time to time. The video is copy-protected, so Netflix cards have no line audio and no screenshot (they still get word audio from akko). Titles whose Japanese subtitles are only pictures can't be read.
- Using the extension on Netflix may go against Netflix's terms of use. It only reads the subtitles your account is already sending to your browser. Use it at your own discretion.
- If akko runs both as the desktop app and in a browser tab, each has its own word list (as before); both get what the extension sends.
