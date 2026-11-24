# OpenAI whisper without ffmpeg (used by server/asr.js).
#
# The `whisper` command always hands its input to ffmpeg, even a WAV that is already what Whisper
# wants, and fails with "FileNotFoundError: [WinError 2]" on a computer without ffmpeg. akko sends
# 16 kHz mono 16-bit WAV, which Python's own `wave` module reads, so this reads it, gives the samples
# straight to whisper's model and writes the SRT next to it — the same file the command would write.
#
#   python whisper-wav.py <audio.wav> <out_dir> <language|auto> <model>

import sys
import wave

import numpy as np

RATE = 16000


def read_wav(path):
    with wave.open(path, "rb") as w:
        channels, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        if width != 2:
            sys.exit(f"only 16-bit WAV can be read without ffmpeg (this one is {width * 8}-bit)")
        data = np.frombuffer(w.readframes(frames), dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    if rate != RATE:                      # akko sends 16 kHz; anything else is resampled simply
        length = int(len(data) * RATE / rate)
        data = np.interp(np.arange(length) * rate / RATE, np.arange(len(data)), data).astype(np.float32)
    return data


def main():
    audio_path, out_dir, language, model_name = sys.argv[1:5]
    audio = read_wav(audio_path)
    import torch
    import whisper
    from whisper.utils import get_writer

    model = whisper.load_model(model_name)
    result = model.transcribe(
        audio,
        language=None if language in ("", "auto") else language,
        fp16=torch.cuda.is_available(),
        verbose=False,
    )
    # older whisper versions need the options; newer ones accept them
    get_writer("srt", out_dir)(result, audio_path, {"highlight_words": False, "max_line_width": None, "max_line_count": None})
    print(f"wrote {len(result.get('segments', []))} segments")


if __name__ == "__main__":
    main()
