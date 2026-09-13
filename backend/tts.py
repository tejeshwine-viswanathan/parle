"""Text-to-speech wrapper around Piper."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from piper import PiperVoice

from . import config

_voice: PiperVoice | None = None


def get_voice() -> PiperVoice:
    global _voice
    if _voice is None:
        if not config.PIPER_MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Piper voice model not found at {config.PIPER_MODEL_PATH}. "
                f"Download it with: python -m piper.download_voices "
                f"--download-dir {config.PIPER_VOICES_DIR} {config.PIPER_VOICE_NAME}"
            )
        _voice = PiperVoice.load(
            config.PIPER_MODEL_PATH,
            config_path=config.PIPER_CONFIG_PATH,
            use_cuda=config.PIPER_USE_CUDA,
        )
    return _voice


def synthesize(text: str, output_path: str | Path) -> Path:
    """Synthesize French text to a WAV file and return its path."""
    voice = get_voice()
    chunks = list(voice.synthesize(text))
    if not chunks:
        raise ValueError("Piper produced no audio for the given text")

    audio = np.concatenate([chunk.audio_float_array for chunk in chunks])
    sample_rate = chunks[0].sample_rate

    output_path = Path(output_path)
    sf.write(output_path, audio, sample_rate)
    return output_path
