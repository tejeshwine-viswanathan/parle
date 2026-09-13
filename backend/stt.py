"""Speech-to-text wrapper around faster-whisper."""

from __future__ import annotations

from pathlib import Path
from typing import TypedDict

from faster_whisper import WhisperModel

from . import config

_model: WhisperModel | None = None

# faster-whisper (like upstream Whisper) was trained on a lot of Amara.org-subtitled
# video, and hallucinates these stock phrases on silence or near-silent audio instead
# of returning nothing. VAD filtering (below) catches most of it; this is a backstop
# for whatever slips through.
_HALLUCINATION_PHRASES = [
    "sous-titres réalisés par la communauté d'amara.org",
    "sous-titrage st' 501",
    "merci d'avoir regardé cette vidéo",
    "merci d'avoir regardé",
    "abonnez-vous",
]


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
    segments = [
        segment
        for segment in segments
        if segment.text.strip().lower().strip(".!? ") not in _HALLUCINATION_PHRASES
    ]

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
