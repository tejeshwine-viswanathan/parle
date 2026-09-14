"""Grammar correction for the topic-practice session review.

Distinct from phrasing.py (style/naturalness) and pronunciation.py (how it
sounded) — this one is strictly about real errors: agreement, conjugation,
gender, missing words. It doesn't restyle correct sentences.

Design note: earlier versions asked the model to regenerate the whole
corrected sentence. That was unreliable even on a 7B model — it would
"correct" already-right sentences, drift tu -> vous, spell out numerals,
occasionally rewrite the sentence's meaning entirely, and even fail to
reproduce its own few-shot examples verbatim. Small prompt tweaks would fix
one failure and reintroduce another (real whack-a-mole).

Instead, the model is asked only to name specific error spans and their
fixes ("FAUX: ... => CORRECT: ..."), which is a much narrower/easier task.
Each proposed span is verified to appear verbatim in the original before
being applied — a hallucinated or out-of-scope "fix" (e.g. anything that
doesn't literally quote the source) is simply dropped rather than applied.
This can't fully eliminate bad suggestions (see _shifted_formality below for
one recurring pattern still worth guarding against explicitly), but it
eliminates the entire class of "rewrote things I never flagged as wrong".
"""

from __future__ import annotations

import re
from typing import TypedDict

from ollama import Client

from . import config

SYSTEM_PROMPT = """Tu es un correcteur grammatical. Tu ne discutes JAMAIS avec \
l'utilisateur. On te donne une phrase française prononcée par un apprenant, encadrée \
par <<< >>>.

Cherche UNIQUEMENT de vraies fautes de grammaire : accord, conjugaison, genre, mot \
manquant, mauvaise préposition. Pour CHAQUE faute trouvée, donne une ligne EXACTEMENT \
au format :
FAUX: <mot(s) fautifs, copiés EXACTEMENT comme dans la phrase> => CORRECT: <correction>

Si la phrase est déjà correcte, réponds UNIQUEMENT avec le mot : AUCUNE

Règles strictes :
- Le texte après "FAUX:" doit être une copie EXACTE d'un passage de la phrase \
originale (mêmes mots, même casse, même orthographe).
- Ne signale JAMAIS comme faute : un changement de politesse (tu/toi/ton vs vous), un \
changement de vocabulaire ou de style, un chiffre écrit en chiffres vs en toutes \
lettres, ou une virgule/ponctuation. Ce ne sont pas des fautes de grammaire.
- Une ligne par faute trouvée. Aucun autre texte, aucune explication, aucune note.

Exemples :
<<<Hier, je mange une pomme et je regardé la télé.>>>
FAUX: je mange => CORRECT: j'ai mangé
FAUX: je regardé => CORRECT: j'ai regardé

<<<Je suis allé au parc avec mes amis.>>>
AUCUNE

<<<Elle a trois chat et un chien.>>>
FAUX: trois chat => CORRECT: trois chats

<<<Ça fait plaisir de travailler avec toi aussi.>>>
AUCUNE

<<<Le week-end dernier, je suis allée au parc avec mes amis.>>>
AUCUNE
"""

_ERROR_LINE = re.compile(r"FAUX:\s*(.+?)\s*=>\s*CORRECT:\s*(.+?)\s*$", re.IGNORECASE)

# The model still occasionally proposes a tu/toi -> vous (or reverse) change
# despite being told not to — this is the one failure pattern common enough
# to guard against explicitly rather than trust the prompt alone.
_TU_WORDS = {"tu", "toi", "ton", "ta", "tes", "te", "t'"}

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = Client(host=config.OLLAMA_HOST)
    return _client


def _shifts_formality(wrong: str, correct: str) -> bool:
    wrong_words = {w.strip(".,!?;:\"'").lower() for w in wrong.split()}
    correct_words = {w.strip(".,!?;:\"'").lower() for w in correct.split()}
    return "vous" in correct_words and bool(wrong_words & _TU_WORDS)


def _find_fixes(text: str) -> list[tuple[str, str]]:
    """Ask the model for (wrong_span, corrected_span) pairs, keeping only ones
    that actually quote the source text and don't shift tu/vous formality."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"<<<{text}>>>"},
    ]
    response = get_client().chat(
        model=config.GRAMMAR_MODEL,
        messages=messages,
        think=False,
        keep_alive=config.OLLAMA_KEEP_ALIVE,
        options={"temperature": 0.0, "num_predict": 200, "repeat_penalty": 1.3},
    )
    raw = response["message"]["content"].strip()
    if not raw or raw.strip(" .!\"'«»").upper() == "AUCUNE":
        return []

    text_word_count = len(text.split())
    fixes: list[tuple[str, str]] = []
    for line in raw.splitlines():
        match = _ERROR_LINE.search(line)
        if not match:
            continue
        wrong = match.group(1).strip().strip("\"'")
        correct = match.group(2).strip().strip("\"'")
        if not wrong or not correct:
            continue
        if wrong not in text:
            continue  # hallucinated span that doesn't exist in the source — drop it
        # A single flagged span covering most of the sentence is a wholesale
        # rewrite wearing a "fix" costume, not a targeted correction — this is
        # the general guard against the model doing that (as opposed to
        # _shifts_formality below, which is a narrow patch for one specific
        # pattern it kept doing anyway; it doesn't generalize and isn't load-
        # bearing the way this one is).
        if text_word_count > 3 and len(wrong.split()) > max(4, text_word_count * 0.6):
            continue
        if _shifts_formality(wrong, correct):
            continue
        fixes.append((wrong, correct))
    return fixes


class Segment(TypedDict):
    text: str
    wrong: bool


class Correction(TypedDict):
    original: str
    corrected: str
    segments: list[Segment]
    has_errors: bool


def _apply_fixes(original: str, fixes: list[tuple[str, str]]) -> tuple[str, list[Segment]]:
    """Apply verified (wrong, correct) substitutions to `original`, producing
    both the corrected text and word-level segments marking exactly what was
    flagged — no fuzzy diffing needed since we know precisely what changed."""
    matches: list[tuple[int, int, str, str]] = []
    for wrong, correct in fixes:
        idx = original.find(wrong)
        if idx != -1:
            matches.append((idx, idx + len(wrong), wrong, correct))

    # Keep matches in source order; drop any that overlap an earlier one.
    matches.sort(key=lambda m: m[0])
    non_overlapping: list[tuple[int, int, str, str]] = []
    last_end = 0
    for start, end, wrong, correct in matches:
        if start >= last_end:
            non_overlapping.append((start, end, wrong, correct))
            last_end = end

    corrected_parts: list[str] = []
    segments: list[Segment] = []
    cursor = 0
    for start, end, wrong, correct in non_overlapping:
        if start > cursor:
            plain = original[cursor:start]
            corrected_parts.append(plain)
            segments.extend({"text": w, "wrong": False} for w in plain.split())
        corrected_parts.append(correct)
        segments.extend({"text": w, "wrong": True} for w in wrong.split())
        cursor = end
    if cursor < len(original):
        plain = original[cursor:]
        corrected_parts.append(plain)
        segments.extend({"text": w, "wrong": False} for w in plain.split())

    return "".join(corrected_parts), segments


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text) if p.strip()]
    return parts or [text]


def review(text: str) -> Correction:
    """Grammar-correct `text`: find real errors sentence-by-sentence, apply
    only the ones that verifiably quote the source, and diff-free segment the
    result for display."""
    all_fixes: list[tuple[str, str]] = []
    for sentence in _split_sentences(text):
        all_fixes.extend(_find_fixes(sentence))

    corrected, segments = _apply_fixes(text, all_fixes)
    return {
        "original": text,
        "corrected": corrected,
        "segments": segments,
        "has_errors": bool(all_fixes) and corrected != text,
    }
