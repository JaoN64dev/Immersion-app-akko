# Native-speaker review

The Japanese lessons, and the Portuguese, Spanish and Japanese versions of the English course and lessons, were written by Claude (an AI). They were reviewed again for mistakes, but **no native speaker has checked them yet**. This page lists what to read and what to look for, so a native speaker can do that pass quickly.

You don't need to know any code: everything is plain text in Markdown files. Edit a file, reload the page in the app, and run `npm run check-lessons` to make sure nothing broke.

## What to check, most important first

### 1. Japanese N2 and N1 grammar (`grammar/`, level N2 / N1)

About 40 lessons. Formal grammar is where "correct but nobody says it that way" happens most. For each lesson:

- Are the **example sentences** natural? Would a Japanese person write them, in a book, the news or a speech?
- Is the **explanation** right, including the register (written, formal, spoken) and the nuance?
- In the **quiz**, is the first answer the only correct one? (A second answer that also works confuses learners. This already happened and was fixed in 14 quizzes.)

Files: open `grammar/` and look for `level: N2` or `level: N1` at the top. For example `ni-chigainai.md`, `zaru-wo-enai.md`, `yogi-naku.md`, `majiki.md`.

N5 to N3 are worth a quick read too, especially the quizzes.

### 2. Portuguese (Brazil): `course-en/pt/` and `grammar-en/pt/`

8 course steps and 38 lessons, written in Brazilian Portuguese for learners of English.

- Natural Brazilian Portuguese? (not Portugal's: *celular*, *ônibus*, *você*)
- Are the tips about mistakes Brazilians make in English right? (e.g. adding an "i" sound at the end of words, "tem" for "there is", "moro aqui há dez anos")
- Do the example translations match the English sentence's meaning and tone?

### 3. Spanish: `course-en/es/` and `grammar-en/es/`

8 course steps and 38 lessons. **Decision needed:** the Spanish leans towards Spain (*móvil*, *coche*, *conducir*, *coger el autobús*, *tarta*, *quedar con alguien*, *deberes*). Most Spanish-speaking learners are in Latin America. Either:

- switch to a neutral Latin American Spanish (*celular*, *carro/auto*, *manejar*, *tomar el autobús*, *pastel*, *tarea*), or
- keep Spain's Spanish and add a separate folder for the other one (a language code such as `es-419` would need a small code change; ask before doing this).

Also check the tips about mistakes Spanish speakers make ("Espain", b/v, "I live here since…").

### 4. Japanese: `course-en/ja/` and `grammar-en/ja/`

8 course steps and 38 lessons explaining English in Japanese. Check that the explanations read naturally and that the grammar terms (現在完了, 仮定法過去, 過去分詞…) are the ones Japanese learners know from school.

### 5. The Japanese interface (`scripts/lang/ja.js`)

The menus, buttons and messages in 日本語. Read them in the app (Settings → Interface language → 日本語) rather than in the file. Look for stiff or overly literal wording.

## How to fix things

- Change the text in the file and save it. Reload the grammar or course page to see the change; no restart needed.
- In a translated lesson (`grammar-en/pt/…`), keep each example line's **English part exactly** as it is, and change only what comes after ` = `.
- A lesson's `detect:` lines only change what gets underlined. If you change an example sentence in a Japanese lesson, run `npm run check-lessons`. It tells you if the underline rules no longer find the grammar in your new sentence.
- Not sure about something? Leave the file as it is and write a note at the top of this page instead.

## Notes from reviewers

*(Add what you checked and what you changed here, with the date, so the next person knows.)*
