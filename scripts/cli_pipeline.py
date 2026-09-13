#!/usr/bin/env python
"""End-to-end local pipeline smoke test: record -> STT -> Ollama tutor -> TTS.

Run from the repo root with the backend venv active:

    python scripts/cli_pipeline.py

Press Enter to start recording, speak French, press Enter again to stop.
The tutor's spoken reply plays back through your speakers. Press Ctrl+C to quit.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import config, stt, tts, tutor

SAMPLE_RATE = 16000


def record_until_enter(sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    frames: list[np.ndarray] = []

    def callback(indata, frame_count, time_info, status) -> None:  # noqa: ANN001
        frames.append(indata.copy())

    input("Press Enter to start recording...")
    print("Recording... press Enter to stop.")
    with sd.InputStream(samplerate=sample_rate, channels=1, dtype="float32", callback=callback):
        input()

    if not frames:
        return np.zeros((0, 1), dtype="float32")
    return np.concatenate(frames, axis=0)


def run_turn(history: list[dict], turn_dir: Path) -> list[dict]:
    audio = record_until_enter()
    if audio.shape[0] == 0:
        print("(no audio captured, try again)")
        return history

    turn_dir.mkdir(parents=True, exist_ok=True)
    user_wav = turn_dir / "user.wav"
    sf.write(user_wav, audio, SAMPLE_RATE)

    print("Transcribing...")
    t0 = time.time()
    transcription = stt.transcribe(user_wav, language="fr")
    print(f"  ({time.time() - t0:.1f}s) You said: {transcription['text']!r}")
    if not transcription["text"]:
        print("(nothing recognized, try again)")
        return history

    print("Asking the tutor...")
    t0 = time.time()
    reply = tutor.get_response(history, transcription["text"])
    print(f"  ({time.time() - t0:.1f}s) Tutor: {reply}")

    print("Synthesizing speech...")
    t0 = time.time()
    reply_wav = turn_dir / "tutor.wav"
    tts.synthesize(reply, reply_wav)
    print(f"  ({time.time() - t0:.1f}s) wrote {reply_wav}")

    audio_out, sr = sf.read(reply_wav, dtype="float32")
    sd.play(audio_out, sr)
    sd.wait()

    return history + [
        {"role": "user", "content": transcription["text"]},
        {"role": "assistant", "content": reply},
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--turns",
        type=int,
        default=0,
        help="Number of turns to run, then exit (default: run until Ctrl+C)",
    )
    args = parser.parse_args()

    print(f"Ollama model: {config.OLLAMA_MODEL} @ {config.OLLAMA_HOST}")
    print(f"Whisper model: {config.WHISPER_MODEL_SIZE} ({config.WHISPER_DEVICE}/{config.WHISPER_COMPUTE_TYPE})")
    print(f"Piper voice: {config.PIPER_VOICE_NAME}")
    print()

    session_dir = config.DATA_DIR / "cli_sessions" / time.strftime("%Y%m%d-%H%M%S")
    history: list[dict] = []
    turn = 0

    try:
        while args.turns == 0 or turn < args.turns:
            turn += 1
            history = run_turn(history, session_dir / f"turn-{turn:02d}")
            print()
    except KeyboardInterrupt:
        print("\nAu revoir !")


if __name__ == "__main__":
    main()
