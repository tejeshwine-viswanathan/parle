"""Offline tests for the Whisper hallucination filter."""

from __future__ import annotations

import pytest

from backend import stt


@pytest.mark.parametrize(
    "text",
    [
        "Sous-titres réalisés par la communauté d'Amara.org",
        " Sous-titres réalisés para la communauté d'Amara.org ",
        "Sous-titrage ST' 501",
        "Merci d'avoir regardé cette vidéo !",
        "Abonnez-vous à la chaîne",
    ],
)
def test_flags_known_hallucinations(text):
    assert stt.is_hallucination(text)


@pytest.mark.parametrize(
    "text",
    [
        "Bonjour, je m'appelle Claire.",
        "Merci beaucoup pour votre aide.",
        "Je regarde la télé le soir.",
        "",
    ],
)
def test_keeps_real_speech(text):
    assert not stt.is_hallucination(text)
