# The course

Every `.md` file in this folder is one step on the **道 course** page, in `order`.

- **Add a step:** copy `_template.md`, rename the copy (e.g. `shadowing.md`) and edit it.
- **Change or reorder steps:** edit the files and reload the page. You don't need to restart the server.
- **Hide a step:** put `hidden: yes` in its settings, or start the file name with `_`.

The file name (without `.md`) is the step's id, and the "done" mark is saved under it, so renaming a file resets that step.

## How a step file looks

```markdown
---
title: Start immersing
summary: Watch anime with Japanese subtitles here, clicking the words you don't know.
when: after kana, ~300 words and the first grammar lessons (around week 3)
order: 50
goal: hours 10 | 10 hours of Japanese watched or listened to
goal: words 500
---

The text of the step, in Markdown: **bold**, *italic*, lists, tables,
> notes in a box
and links, including to pages of the app: [the grammar lessons](/grammar.html), [a lesson](/grammar.html#te-iru).
```

### Settings

| setting | what it does |
|---|---|
| `title` | Name of the step. Required. |
| `summary` | One line under the title. |
| `when` | When to do this step, shown as a tag. |
| `order` | Number that sorts the steps (smaller first). |
| `goal` | Something the app can check, with a progress bar. Write one `goal:` line per goal (see below). |
| `hidden` | `yes` hides the step. |

### Goals

`goal: kind target`, and optionally `| your own label`.

| goal | measures |
|---|---|
| `words 300` | words marked **known** (key 3, or imported from Anki on the Watch page) |
| `grammar N5` | all the grammar lessons of that level marked learned (any level name from the grammar page works) |
| `mined 100` | words mined with "+ mine" |
| `read 20000` | characters read on the Read page |
| `manga 100` | manga pages read |
| `hours 10` | hours watched + listened (from saved positions, so it's rough) |

Goals only show progress. A step counts as finished when you press **mark as done**, so you decide when you're ready to move on.

Problems in a step file (an unknown goal, a missing title…) are listed at the top of the course page and printed in the server's terminal.

## The English course

The steps for people learning English are in `course-en/`, in the same format. The `grammar` goal uses the English levels there (`goal: grammar A1`).

### Translating the English course

People learning English read the course in their own language (Settings → "Your language"). Each translation is a folder inside `course-en/` named with the same language code as that setting (`pt`, `es`, `ja`, `fr`, `de`, `cmn`…), with one file per step, named like the English one:

```markdown
---
title: Os sons do inglês
summary: Acostume o ouvido ao inglês americano.
when: semanas 1–2
# optional: the goals' labels, in the same order as in the English file
goal: words 500 | conhecer suas primeiras 500 palavras
---

The step's text, translated.
```

Only the title, summary, when, text and goal labels come from the translation. The order and the goals themselves stay in the English file. A step that isn't translated shows in English. Portuguese (`pt`), Spanish (`es`) and Japanese (`ja`) are included.
