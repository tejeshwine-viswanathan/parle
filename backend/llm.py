"""Shared Ollama client and chat helper so every module gets the same defaults."""

from __future__ import annotations

from ollama import Client

from . import config

Message = dict[str, str]

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = Client(host=config.OLLAMA_HOST)
    return _client


def chat(messages: list[Message], *, model: str | None = None, options: dict | None = None) -> str:
    """One chat completion with project-wide defaults: no hidden reasoning trace,
    the configured keep-alive, and an explicit context window (Ollama's default
    of 2048 tokens silently drops the system prompt once a conversation grows)."""
    response = get_client().chat(
        model=model or config.OLLAMA_MODEL,
        messages=messages,
        think=False,
        keep_alive=config.OLLAMA_KEEP_ALIVE,
        options={"num_ctx": config.OLLAMA_NUM_CTX, **(options or {})},
    )
    return response["message"]["content"].strip()
