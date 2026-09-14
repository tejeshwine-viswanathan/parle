"""Text-to-speech wrapper around Piper."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from piper import PiperVoice

from . import config


@dataclass(frozen=True)
class VoiceOption:
    id: str
    label: str
    gender: str


# Known voices we ship instructions/config for. Only ones whose model files are
# actually present under PIPER_VOICES_DIR are ever returned by list_voices().
KNOWN_VOICES = [
    VoiceOption("fr_FR-siwis-medium", "Siwis", "female"),
    VoiceOption("fr_FR-gilles-low", "Gilles", "male"),
]

_voices: dict[str, PiperVoice] = {}
_voices_lock = threading.Lock()


def _voice_paths(voice_id: str) -> tuple[Path, Path]:
    return (
        config.PIPER_VOICES_DIR / f"{voice_id}.onnx",
        config.PIPER_VOICES_DIR / f"{voice_id}.onnx.json",
    )


def list_voices() -> list[VoiceOption]:
    """Voices we know about whose model files are actually downloaded."""
    return [v for v in KNOWN_VOICES if _voice_paths(v.id)[0].exists()]


def get_voice(voice_id: str | None = None) -> PiperVoice:
    voice_id = voice_id or config.PIPER_VOICE_NAME
    # The id becomes a filename, so only ever accept one we ship — otherwise a
    # request could point the loader at any .onnx file on disk via "../".
    if voice_id not in {v.id for v in KNOWN_VOICES}:
        raise FileNotFoundError(f"Unknown voice: {voice_id!r}")
    with _voices_lock:
        if voice_id not in _voices:
            model_path, config_path = _voice_paths(voice_id)
            if not model_path.exists():
                raise FileNotFoundError(
                    f"Piper voice model not found at {model_path}. "
                    f"Download it with: python -m piper.download_voices "
                    f"--download-dir {config.PIPER_VOICES_DIR} {voice_id}"
                )
            _voices[voice_id] = PiperVoice.load(
                model_path,
                config_path=config_path,
                use_cuda=config.PIPER_USE_CUDA,
            )
        return _voices[voice_id]


def synthesize(text: str, output_path: str | Path, voice_id: str | None = None) -> Path:
    """Synthesize French text to a WAV file and return its path."""
    voice = get_voice(voice_id)
    chunks = list(voice.synthesize(text))
    if not chunks:
        raise ValueError("Piper produced no audio for the given text")

    audio = np.concatenate([chunk.audio_float_array for chunk in chunks])
    sample_rate = chunks[0].sample_rate

    output_path = Path(output_path)
    # Explicit format: callers write to a temp name first, so the extension
    # isn't always .wav for soundfile to infer from.
    sf.write(output_path, audio, sample_rate, format="WAV")
    return output_path
