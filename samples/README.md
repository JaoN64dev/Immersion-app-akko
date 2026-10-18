# Samples

What a new learner can click on in the first minute, before finding videos or books of their own.

| File | What it is | Where it shows |
|---|---|---|
| `wagahai-1.txt` | Chapter one (一) of 吾輩は猫である by 夏目漱石 (Natsume Sōseki) | added to the **Read** library the first time, while it's empty (Japanese) |
| `alice-1.txt` | Chapter one of *Alice's Adventures in Wonderland* by Lewis Carroll | the same, when learning English |
| `wagahai.webm` | The novel's first eight sentences read aloud over a drawn cat (38 s) | **Watch** → "try the sample" |
| `wagahai.srt` | Its subtitles, timed to the voice | loaded with the video |

## Where they come from, and their licenses

- **The text**: 吾輩は猫である (1905–1906) is in the public domain (Sōseki died in 1916). The text is [Aozora Bunko](https://www.aozora.gr.jp/cards/000148/card789.html)'s, whose credits are kept at the end of `wagahai-1.txt` (底本：「夏目漱石全集1」ちくま文庫; 入力：柴田卓治; 校正：渡部峰子).
- **Alice**: *Alice's Adventures in Wonderland* (1865) is in the public domain; the text is [Project Gutenberg](https://www.gutenberg.org/ebooks/11)'s, its wrapped lines joined back into paragraphs.
- **The voice**: VOICEVOX:青山龍星, made with [VOICEVOX](https://voicevox.hiroshiba.jp/). The voice may be used with this credit, which is shown in the video and in akko.
- **The picture**: drawn by akko's own code (a canvas animation), recorded in Chrome; under akko's MIT license.

## Making the video again

The video was made by a script (kept outside this repository) that asks a running VOICEVOX for each sentence (speaker 13, speed 0.92), plays them over a canvas animation in Chrome, records both with `MediaRecorder` (VP9 + Opus), and writes the subtitles from the moment each line starts. Chrome's recordings have no seek index, so the file was then copied through ffmpeg (`-c copy -cues_to_front 1`, no re-encoding) to make it seekable. VOICEVOX reads a few words differently from Sōseki's furigana, so it was given kana for those (捕えて → つかまえて, 考 → かんがえ, 恐しい → おそろしい); the subtitles keep the original spelling.
