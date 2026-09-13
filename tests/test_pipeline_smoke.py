"""Offline smoke test for the local pipeline (TTS -> STT -> Ollama -> TTS).

Synthesizes a known French sentence instead of recording from a mic, so this
can run headless/in CI. Requires Ollama running locally with the configured
model pulled, and the Piper voice model downloaded (see README).
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import stt, tts, tutor

SEED_TEXT = "Bonjour, je m'appelle Claude et j'apprends le français."


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        print(f"1. Synthesizing seed text: {SEED_TEXT!r}")
        seed_wav = tts.synthesize(SEED_TEXT, tmp_path / "seed.wav")
        assert seed_wav.exists() and seed_wav.stat().st_size > 0
        print(f"   -> wrote {seed_wav} ({seed_wav.stat().st_size} bytes)")

        print("2. Transcribing it back with faster-whisper...")
        transcription = stt.transcribe(seed_wav, language="fr")
        print(f"   -> {transcription['text']!r} (lang={transcription['language']}, "
              f"p={transcription['language_probability']:.2f}, "
              f"{len(transcription['words'])} words)")
        assert transcription["text"], "STT returned empty text"
        assert transcription["language"] == "fr"

        print("3. Asking the Ollama tutor for a reply...")
        reply = tutor.get_response([], transcription["text"])
        print(f"   -> {reply!r}")
        assert reply, "Tutor returned empty reply"

        print("4. Synthesizing the tutor's reply...")
        reply_wav = tts.synthesize(reply, tmp_path / "reply.wav")
        assert reply_wav.exists() and reply_wav.stat().st_size > 0
        print(f"   -> wrote {reply_wav} ({reply_wav.stat().st_size} bytes)")

    print("\nAll stages OK: TTS -> STT -> Ollama -> TTS")


if __name__ == "__main__":
    main()
