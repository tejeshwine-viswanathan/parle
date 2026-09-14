"""FR<->EN translation via Argos Translate — a dedicated offline machine-translation
model, not the conversational LLM used elsewhere in this app.

Translation was originally implemented by prompting the same small chat LLM used
for the tutor ("here's text, translate it, don't respond to it"). On colloquial or
confrontational French that's fluent for a general-purpose chat model, it would
too often either respond to the text as if speaking to the user, or translate it
but with the subject/object quietly swapped — errors that read as fluent English
and are easy to miss. A real MT model doesn't improvise: it's less idiomatic on
tricky phrasing, but it translates literally and deterministically every time,
with no persona to break out of.
"""

from __future__ import annotations

from typing import Literal

import argostranslate.translate

Direction = Literal["fr-en", "en-fr"]

_LANGS: dict[Direction, tuple[str, str]] = {
    "fr-en": ("fr", "en"),
    "en-fr": ("en", "fr"),
}


def _get_translation(from_code: str, to_code: str) -> argostranslate.translate.ITranslation:
    installed = argostranslate.translate.get_installed_languages()
    from_lang = next((lang for lang in installed if lang.code == from_code), None)
    to_lang = next((lang for lang in installed if lang.code == to_code), None)
    translation = (from_lang.get_translation(to_lang) if from_lang and to_lang else None)
    if translation is None:
        raise FileNotFoundError(
            f"Argos Translate {from_code}->{to_code} model not installed. Install it with: "
            "python scripts/install_translate_models.py"
        )
    return translation


def translate(text: str, direction: Direction) -> str:
    """Translate `text` between French and English using a local MT model."""
    from_code, to_code = _LANGS[direction]
    return _get_translation(from_code, to_code).translate(text).strip()
