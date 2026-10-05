# Grammar lessons

Every `.md` file in this folder is one lesson on the **文法 grammar** page when you're learning Japanese. The lessons for learning English are in `grammar-en/` and work the same way (see [English lessons](#english-lessons) at the end).

- **Add a lesson:** copy `_template.md`, rename the copy (e.g. `te-mo.md`) and edit it.
- **Change a lesson:** edit its file and reload the page. You don't need to restart the server.
- **Hide a lesson:** put `hidden: yes` in its settings, or start the file name with `_`.

The file name (without `.md`) is the lesson's id. Its address is `/grammar.html#te-iru`, and other lessons link to it with `see: te-iru`. If you rename a file, the "learned" mark saved for the old name is lost.

## How a lesson file looks

```markdown
---
title: 〜ている
meaning: is doing / is in a state
level: N5
order: 30
detect: て|で + いる[非自立]
detect: てる|でる[非自立]
see: te-form, te-aru
---

The explanation. **Bold**, *italic*, `code`, [links](https://…), lists,
> notes in a box
and tables:

| plain | polite |
|---|---|
| 食べている | 食べています |

## Examples
- 今、ご飯を食べている。 = I'm eating right now.
- 窓が開いている。 = The window is open.

## Quiz
- 弟は今、テレビを＿＿＿。(見る) = 見ている | 見るいる | 見ていた
- 「食べている」 casual form? = 食べてる
```

### Settings (between the two `---` lines)

| setting | what it does |
|---|---|
| `title` | Name shown in the list and the popup. Required. |
| `meaning` | One-line summary, shown under the title and in the word popup. |
| `level` | Group in the list. `N5` … `N1` are sorted in that order; any other text (e.g. `basics`, `casual speech`) makes its own group after them. |
| `order` | Number that sorts lessons inside a level (smaller first). Lessons without it are sorted by title. |
| `detect` | A pattern to find this grammar in subtitles, texts and podcasts (see below). Write one `detect:` line per pattern. Leave it out and the lesson is never underlined. |
| `see` | Ids of related lessons, separated by commas. |
| `hidden` | `yes` hides the lesson. |

A line starting with `#` inside the settings is a comment.

### Sections

- Everything before `## Examples` is the explanation.
- `## Examples` (or `## 例文`): one example per line, `- Japanese = translation`. The Japanese is split into clickable words, like everywhere else on the site.
- `## Quiz` (or `## 練習`): one question per line, `- question = right answer | wrong answer | wrong answer`. **The first answer is the right one.** The page shuffles them. If you write only one answer, the quiz asks you to type it instead.

## Detect rules

The site splits each line into small pieces with [kuromoji](https://github.com/takuyaa/kuromoji.js). A rule describes pieces that come one after another, joined with ` + `:

```
detect: て|で + いる[非自立]
```

Each step is one piece. A step can be:

| step | matches a piece that is… |
|---|---|
| `いる` | written いる, or whose dictionary form is いる (so `いる` also matches い in 食べています) |
| `て\|で` | て or で (`\|` means "or") |
| `[動詞]` or `[verb]` | that part of speech |
| `いる[非自立]` | both: いる **and** that part of speech |
| `*` | anything |
| `!で\|に` | not a word itself: the word **before** the next step must not be で or に ("not after") |

Part-of-speech names you can use in brackets: `verb` 動詞, `noun` 名詞, `adjective`/`adj` 形容詞, `adverb` 副詞, `particle` 助詞, `aux` 助動詞, `suffix` 接尾, `conjunction` 接続詞, and any of kuromoji's own detail names such as `接続助詞`, `格助詞`, `非自立`, `助動詞語幹`.

**How to find the right pieces:** open the lesson. Under the examples it says how many of them the rules found, and the found grammar is underlined in purple. If an example isn't underlined, the rule doesn't fit how kuromoji splits it. Common splits:

| text | pieces (dictionary form) |
|---|---|
| 読んでいる | 読ん(読む) · で · いる |
| 食べてる | 食べ(食べる) · てる |
| 食べちゃった | 食べ · ちゃっ(ちゃう) · た |
| 行かなければならない | 行か · なけれ(ない) · ば · なら(なる) · ない |
| 食べたら | 食べ · たら(た) |
| 美味しそう | 美味し(美味しい) · そう *(接尾)* |
| 雨が降るそうだ | 雨 · が · 降る · そう *(特殊)* · だ |

**Check your lessons** after editing them: `npm run check-lessons` reads every lesson file and course step, and checks that each lesson's detect rules still find the grammar in all of its own examples. Add `-- --verbose` to also see which examples other lessons underline too.

Problems in a lesson file (a rule it can't read, a `see:` that points nowhere…) are listed at the top of the grammar page and printed in the server's terminal.

## English lessons

`grammar-en/` holds the lessons for learning English (written in simple English). Same format, with three differences:

- **Levels** are CEFR: `A1`, `A2`, `B1`, `B2`, `C1`, `C2` (sorted in that order).
- **Examples** are `- English sentence`, optionally `= a translation or note`.
- **Detect rules** work on English words, after contractions are split (`don't` -> `do` + `n't`, `I'm` -> `i` + `'m`, `can't` -> `can` + `n't`):

| step | matches |
|---|---|
| `have` | the word exactly as written (lower case): `have`, not `has` or `had` |
| `~have` | any form of the word: have, has, had, having, `'ve` |
| `'s`, `'re`, `'ll`, `'d`, `n't` | the contracted pieces |
| `[ing]` `[past]` `[pp]` `[s]` `[er]` `[est]` | -ing form, past, past participle, -s, comparative, superlative |
| `[base]` | a verb in its plain form (the swim in "can swim") |
| `[verb]` `[adj]` `[noun]` `[adv]` | what the word can be (from the dictionary, so a word can be several) |
| `[modal]` `[pronoun]` `[wh]` `[article]` | can/will/should…, I/you/it…, what/who/how…, a/an/the |
| `*` | anything |
| `!would\|could` | not a word itself: the word **before** the next step must not be would or could. `!would + have + [pp]` finds "I have seen" but not "I would have seen" |

For example `have|has|'ve + [pp]` finds the present perfect, and `~be + going + to + [base]` finds "be going to".

### Translating lessons

Lessons can be read in the learner's own language (Settings → "Your language"). Each translation is a folder inside `grammar-en/` (English lessons) or `grammar/` (Japanese lessons) named with that language's code (`pt`, `es`, `ja`, `fr`, `de`, `cmn`…), with one file per lesson, named like the English one:

```markdown
---
title: Present perfect (I have seen)
meaning: experiências, coisas recém-terminadas, coisas que continuam
---

The explanation, in that language.

## Examples
- Have you ever eaten sushi? = Você já comeu sushi?
- I've already seen this movie. = Já vi este filme.
```

- Each example line repeats the **example sentence exactly** as in the main file (English or Japanese), then ` = ` and its translation.
- The title, meaning and explanation replace the English ones. A `## Quiz` section, if there is one, replaces the quiz.
- Level, order, detect rules and the English examples stay in the English file, so they're set in one place.
- A lesson that isn't translated shows in English.
- `npm run check-lessons` reports translated examples that don't match the English file.

Included: the English lessons in Portuguese (`pt`), Spanish (`es`) and Japanese (`ja`); the Japanese **N5** lessons in Portuguese and Spanish (`grammar/pt`, `grammar/es`). A `## Quiz` in a translation must keep the same answers, in the same order; only the questions change.
