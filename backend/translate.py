"""FR<->EN translation, powered by the same local Ollama model as the tutor."""

from __future__ import annotations

from typing import Literal

from ollama import Client

from . import config

Direction = Literal["fr-en", "en-fr"]

_SYSTEM_PROMPTS: dict[Direction, str] = {
    "fr-en": (
        "Tu es un traducteur. Traduis le texte français suivant en anglais. "
        "Réponds uniquement avec la traduction, sans commentaire ni guillemets."
    ),
    "en-fr": (
        "You are a translator. Translate the following English text into French. "
        "Reply with only the translation, no commentary or quotation marks."
    ),
}

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = Client(host=config.OLLAMA_HOST)
    return _client


def translate(text: str, direction: Direction) -> str:
    """Translate `text` between French and English using the local LLM."""
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPTS[direction]},
        {"role": "user", "content": text},
    ]
    response = get_client().chat(
        model=config.OLLAMA_MODEL,
        messages=messages,
        think=False,
        keep_alive=config.OLLAMA_KEEP_ALIVE,
    )
    return response["message"]["content"].strip()
