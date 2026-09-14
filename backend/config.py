"""Central config, loaded from environment variables (see .env.example)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent

load_dotenv(REPO_ROOT / ".env")

# Ollama
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
# How long Ollama keeps the model loaded in (V)RAM after the last request,
# so a whole practice session doesn't pay the model-load cost on every turn.
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")
# Context window for every chat call. Ollama defaults to 2048 tokens, which a
# practice session outgrows in ~15 turns — at that point the oldest tokens (the
# system prompt) are silently dropped and the tutor stops following its rules.
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "8192"))
# Grammar correction (backend/grammar.py) is a harder task for a small model than
# the tutor/translation prompts — small models are unreliable at it, sometimes
# even "correcting" already-right sentences into wrong ones. Defaults to the main
# model so a fresh clone works with only one model pulled; set this to a larger
# model you already have (e.g. `mistral:7b`, or `gemma4:26b`/similar for the best
# accuracy we've seen — at the cost of ~2min to load cold, ~15s per sentence warm)
# if you want more reliable corrections.
GRAMMAR_MODEL = os.getenv("GRAMMAR_MODEL", OLLAMA_MODEL)

# Speech-to-text (faster-whisper)
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

# Text-to-speech (Piper)
PIPER_VOICE_NAME = os.getenv("PIPER_VOICE_NAME", "fr_FR-siwis-medium")
PIPER_VOICES_DIR = Path(os.getenv("PIPER_VOICES_DIR", BACKEND_DIR / "voices"))
PIPER_USE_CUDA = os.getenv("PIPER_USE_CUDA", "false").lower() == "true"

# Local data storage (session history, never leaves the machine)
DATA_DIR = Path(os.getenv("DATA_DIR", REPO_ROOT / "data"))
