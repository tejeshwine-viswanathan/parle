"""Conversational tutor orchestration, powered by a local Ollama model."""

from __future__ import annotations

from ollama import Client

from . import config

SYSTEM_PROMPT = """Tu es Parlé, un tuteur de français patient et encourageant pour un \
apprenant anglophone de niveau débutant à intermédiaire.

Règles :
- Réponds TOUJOURS en français, avec des mots simples et des phrases courtes.
- Reste chaleureux et encourageant, jamais condescendant.
- Termine toujours ta réponse par une question de suivi ou une nouvelle invite \
pour que la conversation continue.
- Garde chaque réponse à 2-4 phrases maximum.
"""

Message = dict[str, str]

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = Client(host=config.OLLAMA_HOST)
    return _client


def get_response(history: list[Message], user_text: str) -> str:
    """Given prior turns and the learner's latest French utterance, return the
    tutor's French reply (a comment/correction plus a follow-up question)."""
    messages: list[Message] = (
        [{"role": "system", "content": SYSTEM_PROMPT}]
        + history
        + [{"role": "user", "content": user_text}]
    )
    response = get_client().chat(
        model=config.OLLAMA_MODEL,
        messages=messages,
        think=False,
        keep_alive=config.OLLAMA_KEEP_ALIVE,
    )
    return response["message"]["content"].strip()
