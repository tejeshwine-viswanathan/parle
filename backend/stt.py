"""Speech-to-text wrapper around faster-whisper."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import TypedDict

from faster_whisper import WhisperModel

from . import config

_model: WhisperModel | None = None
_model_lock = threading.Lock()

# faster-whisper (like upstream Whisper) was trained on a lot of Amara.org-subtitled
# video, and hallucinates these stock phrases on silence or near-silent audio instead
# of returning nothing. VAD filtering (below) catches most of it; this is a backstop
# for whatever slips through. Matched as substrings so spelling/casing variants
# ("Sous-titres réalisés para la communauté d'Amara.org") are caught too.
_HALLUCINATION_MARKERS = [
    "amara.org",
    "sous-titrage st'",
    "sous-titres réalisés",
    "merci d'avoir regardé",
    "abonnez-vous",
]


def is_hallucination(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _HALLUCINATION_MARKERS)


class Word(TypedDict):
    word: str
    start: float
    end: float
    probability: float


class Transcription(TypedDict):
    text: str
    language: str
    language_probability: float
    words: list[Word]


def get_model() -> WhisperModel:
    global _model
    with _model_lock:
        if _model is None:
            _model = WhisperModel(
                config.WHISPER_MODEL_SIZE,
                device=config.WHISPER_DEVICE,
                compute_type=config.WHISPER_COMPUTE_TYPE,
            )
        return _model


def transcribe(audio_path: str | Path, language: str = "fr") -> Transcription:
    """Transcribe a French audio file, with word-level confidence scores.

    Word-level probabilities feed the pronunciation-feedback module later.
    """
    model = get_model()
    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        word_timestamps=True,
        vad_filter=True,
    )
    segments = [segment for segment in segments if not is_hallucination(segment.text)]

    words: list[Word] = [
        {
            "word": word.word.strip(),
            "start": word.start,
            "end": word.end,
            "probability": word.probability,
        }
        for segment in segments
        for word in (segment.words or [])
    ]

    return {
        "text": "".join(segment.text for segment in segments).strip(),
        "language": info.language,
        "language_probability": info.language_probability,
        "words": words,
    }
