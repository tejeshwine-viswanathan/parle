"""Best-effort pronunciation coaching from faster-whisper's word confidences.

There's no reference audio to do real acoustic phonetic scoring against, so this
flags words the ASR model itself was unsure about (a low `probability` from
word_timestamps) and attaches a plain-language tip about the most likely culprit
sound in that word. Known French pronunciation pitfalls for English speakers are
matched first; anything else falls back to a short Ollama-generated tip. Treat
this as coaching, not a lab-grade pronunciation score.
"""

from __future__ import annotations

import re
from typing import TypedDict

from ollama import Client

from . import config
from .stt import Transcription, Word

# Below this word-level confidence, faster-whisper was guessing — likely because
# the pronunciation was off enough to obscure the word.
CONFIDENCE_THRESHOLD = 0.6

# Checked in order; the first pattern that matches a flagged word wins. Patterns
# are simple substrings/regexes over the lowercased word, not a real phonemizer.
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"ou"), "'ou' is a rounded, back 'oo' sound, like in 'food' — not the English 'ow'."),
    (re.compile(r"eu|œu"), "'eu' — round your lips like you're about to whistle, tongue held mid-high."),
    (re.compile(r"oi"), "'oi' sounds like 'wa', not the English 'oy'."),
    (re.compile(r"gn"), "'gn' is one soft sound, like the 'ny' in 'canyon' — not a hard g."),
    (re.compile(r"ç"), "'ç' is always soft, pronounced like an 's'."),
    (re.compile(r"^h"), "the French 'h' is silent — start the word on the vowel right after it."),
    (re.compile(r"ill|^ll"), "'ill' after a vowel usually sounds like 'y', not a hard 'l'."),
    (re.compile(r"[aeiouéèêë](n|m)(?:[bdfgjklpqstvwxz]|$)"), "that vowel+n/m is nasal — push air through your nose and don't pronounce the n/m itself."),
    (re.compile(r"u"), "the 'u' — round your lips and push your tongue forward, it's not like 'oo' in 'food'."),
    (re.compile(r"r"), "the French 'r' is throaty, made at the back of the throat — not rolled or tapped."),
    (re.compile(r"[td]$"), "many final consonants are silent in French unless followed by 'e' or a liaison."),
]

_client: Client | None = None


def _get_client() -> Client:
    global _client
    if _client is None:
        _client = Client(host=config.OLLAMA_HOST)
    return _client


def _fallback_tip(word: str) -> str:
    """Ask the local model for a short tip when no known pattern matches."""
    messages = [
        {
            "role": "user",
            "content": (
                "In one short, plain-language sentence, give an English-speaking "
                f"French learner a pronunciation tip for the French word '{word}'."
            ),
        }
    ]
    response = _get_client().chat(
        model=config.OLLAMA_MODEL,
        messages=messages,
        think=False,
        keep_alive=config.OLLAMA_KEEP_ALIVE,
    )
    return response["message"]["content"].strip()


def _tip_for(word: str) -> str:
    lowered = word.lower()
    for pattern, tip in _PATTERNS:
        if pattern.search(lowered):
            return tip
    return _fallback_tip(word)


class PronunciationNote(TypedDict):
    word: str
    start: float
    end: float
    probability: float
    tip: str


def analyze(transcription: Transcription) -> list[PronunciationNote]:
    """Flag likely-mispronounced words in a French transcription with a tip each."""
    return [_note_for(word) for word in transcription["words"] if _is_flagged(word)]


def _is_flagged(word: Word) -> bool:
    return len(word["word"].strip()) > 1 and word["probability"] < CONFIDENCE_THRESHOLD


def _note_for(word: Word) -> PronunciationNote:
    return {
        "word": word["word"],
        "start": word["start"],
        "end": word["end"],
        "probability": word["probability"],
        "tip": _tip_for(word["word"]),
    }
