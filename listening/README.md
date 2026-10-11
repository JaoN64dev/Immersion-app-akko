# Listening exercises (聴解)

Each `.md` file is one set of listening questions on the **聴解** page (Japanese only). Files
starting with `_` (like `_template.md`) and README.md are skipped. Edits show up when you reload the
page; no restart needed. `npm run check-lessons` checks every file.

**Where to put your own sets:** the `listening` folder inside akko's data folder. The page shows
its full path at the bottom ("Your folder"); in the desktop app, **akko → Open the data folder**
opens the data folder (on Windows `%APPDATA%\akko\data\listening`). Running akko from the code,
it's `data/listening/`. The sets in akko's own `listening/` folder are the ones that come with it.

Any line you write can be heard. The voices, best first (pick one under **voice** on the page):

- **VOICEVOX** (free, natural-sounding Japanese voices, [voicevox.hiroshiba.jp](https://voicevox.hiroshiba.jp/)):
  on Windows, the 聴解 page has a button that downloads it from VOICEVOX's official release
  (about 1.9 GB) into akko's data folder. akko also finds a VOICEVOX you installed yourself. It
  starts in the background whenever akko opens (untick "start it with akko" to stop that) and
  closes when akko quits. AivisSpeech, if it's open, works too. The voices used are credited
  under the exercise, as VOICEVOX asks. akko doesn't ship VOICEVOX: its terms don't allow that.
- your browser's natural online voices (Edge's "Natural" voices, Chrome's Google voice), when akko
  is open in that browser
- your computer's Japanese voices (on Windows: Haruka and Ayumi for women, Ichiro for men; add
  Japanese in Settings → Time & language → Speech)

A question can also play a **real recording** instead (see `audio:` below).

## The settings block

```
---
title: 会話 conversations
level: N5
order: 1
kind: dialogue
---
```

| setting | what it does |
|---|---|
| `title` | the name in the list |
| `level` | `N5`, `N4`, `N3`, `N2` or `N1` |
| `order` | where it goes inside its level (smaller first) |
| `kind` | `dialogue` (a question about a conversation, written choices), `response` (one line, spoken replies) or `situation` (a situation is described, then what you could say is spoken) |
| `question` | `after`: ask the question only at the end, not before too (for talks where you listen for the main point, the JLPT's 概要理解) |

## Questions

Each `## heading` starts a question. The heading is just a name for you. Inside it:

| line | meaning |
|---|---|
| `Q: 男の人はどこへ行きますか。` | the question (said before and after the conversation). Needed for `dialogue` |
| `男: すみません。` | a line said by a man |
| `女: はい。` | a line said by a woman |
| `- 郵便局 *` | a choice; the right one ends with ` *` (exactly one per question, 2 to 4 choices). The page shuffles the choices each time, so their order in the file doesn't matter |
| `> He's looking for…` | an explanation, shown after answering |
| `audio: talk.mp3` | play this recording instead of the computer voices (see below) |

Any line (questions, lines, choices) can have its translation after ` = `:

```
女: 遅くなって、すみません。 = Sorry I'm late.
```

Translations are shown with the script after you answer.

### `dialogue`

The question is said, then the conversation, then the question again, like the JLPT. The choices
are written on screen.

```
## 郵便局
Q: 男の人はこれからどこへ行きますか。 = Where is the man going now?
男: すみません、この近くに郵便局はありますか。 = Excuse me, is there a post office near here?
女: はい、ありますよ。あの銀行の隣です。 = Yes, there is. It's next to that bank.
- 銀行
- 郵便局 *
- 駅
> He's looking for the post office; the bank is only where it is.
```

### `response`

One line (or two), then each choice is **said** by the other speaker. The choices aren't written
until you answer (unless "show the text" is ticked), like the JLPT's 即時応答.

```
## 遅れて
女: 遅くなって、すみません。 = Sorry I'm late.
- いいえ、大丈夫ですよ。 * = No, it's fine.
- はい、遅いです。 = Yes, it's slow.
- どういたしまして。 = You're welcome.
```

### `situation`

The `Q:` line describes the situation and asks what you'd say. It's said once, then each choice
is said aloud (the JLPT's 発話表現). No `男:`/`女:` lines are needed.

```
## 誕生日
Q: 今日は友だちの誕生日です。何と言いますか。 = It's your friend's birthday. What do you say?
- お誕生日おめでとう。 * = Happy birthday.
- ありがとう。 = Thank you.
- お疲れさま。 = Good work today.
```

## Real recordings: `audio:`

Put a sound file (.mp3, .m4a, .ogg, .wav…) in the same folder as your set and add an `audio:` line
to a question. Play then plays the recording instead of the computer voices:

```
audio: talk.mp3
audio: talk.mp3 1:05-1:48
```

The second form plays only that part of the file (minutes:seconds, or just seconds), so one long
recording can hold all the questions. With a recording, the `Q:` and `男:`/`女:` lines are optional:
write them if you want the script shown after answering. Choices keep their order (they aren't
shuffled), so they can simply be the numbers said in the recording:

```
## 1番
audio: n4-sample.mp3 0:42-2:10
- 1
- 2 *
- 3
- 4
> The official answer sheet says 2.
```

**The official JLPT samples.** jlpt.jp has free sample tests with real exam audio for every level
(the 聴解 page links to them). They're for personal study: download the audio and the question
booklet (PDF) there, put the audio in your folder, and write a set that points at its parts. Keep
those files to yourself; akko doesn't include them because they aren't ours to share. The same
goes for any recording: use your own, or ones you're allowed to use (a friend reading the scripts
of the sets that come with akko is perfect).

## Drills that need no file

Each level also has:

- **文 sentences**: the example sentences of that level's grammar lessons (`grammar/*.md`); pick
  what they mean. Translations come in your language when the lesson is translated
  (`grammar/pt/`, `grammar/es/`).
- **書き取り dictation**: the same sentences; type what you hear. It's checked by how it's read,
  so kana is fine, and what you missed is marked.
- **復習 mistakes**: the questions you got wrong in any set of that level, until you get them
  right (it appears once there's something in it).
