"""Suggests a more natural/idiomatic way to phrase what the learner said.

Distinct from pronunciation.py: that flags how something sounded, this is about
word choice and phrasing — offering the way a native speaker would more likely
say the same thing, when there's a meaningfully more natural option.
"""

from __future__ import annotations

import re

from . import llm

SYSTEM_PROMPT = """Tu es un correcteur de style. Tu ne discutes JAMAIS avec l'utilisateur \
et tu ne réponds JAMAIS à ses questions. Ton unique tâche : recevoir une phrase française \
prononcée par un apprenant, encadrée par <<< >>>, et décider si un locuteur natif la \
dirait différemment (mot plus naturel, expression idiomatique, tournure plus courante).

- Si oui : réponds UNIQUEMENT avec la phrase reformulée en français, rien d'autre.
- Si la phrase est déjà naturelle : réponds UNIQUEMENT avec AUCUNE.
- Ne change JAMAIS le sens, le sujet, ni qui parle à qui.
- IMPORTANT : ta reformulation doit garder TOUTES les idées de la phrase source, même si \
elle est longue ou contient plusieurs propositions. N'en résume aucune partie et n'en \
supprime aucune — reformule le style, phrase après phrase si besoin, mais ne raccourcis \
jamais le contenu. Une reformulation qui ne dit qu'une partie de ce que l'apprenant a dit \
est un échec, même si elle sonne naturelle.
- Ignore les fautes de grammaire mineures — ce n'est pas de la correction grammaticale.
- N'ajoute jamais de guillemets, de commentaire, ou de politesse.
- En cas de doute, réponds AUCUNE. Ne reformule que si le gain de naturel est clair.

Exemples :
<<<Je suis très content de voir toi aujourd'hui.>>>
Je suis très content de te voir aujourd'hui.

<<<Bonjour, comment ça va ?>>>
AUCUNE

<<<Il y a beaucoup de personnes qui pensent que ça.>>>
Beaucoup de gens pensent ça.

<<<Non mais attends, tu dis que tu es fatigué, mais moi je pense que c'est plus une \
question de motivation que de fatigue, parce que si tu voulais vraiment sortir marcher \
avec moi tu trouverais le temps, tu sais, même dix minutes ça suffirait pour commencer.>>>
Attends, tu dis que tu es fatigué, mais moi je pense que c'est plutôt une question de \
motivation, parce que si tu voulais vraiment venir marcher avec moi, tu trouverais le \
temps — même dix minutes suffiraient pour commencer.
"""

# On a longer, multi-clause sentence the small model sometimes ignores the "keep every
# idea" instruction and returns a short gist instead of a full rephrasing — fluent, but
# silently dropping most of what the learner said (and occasionally reversing the point
# entirely, e.g. turning a disagreement into agreement). A real tightened-but-complete
# rephrasing rarely loses more than ~40% of the word count; below that, on a source long
# enough for it to matter, treat it as a dropped-content failure rather than a suggestion.
_MIN_SOURCE_WORDS_TO_CHECK = 10
_MIN_LENGTH_RATIO = 0.6


def _looks_truncated(source: str, candidate: str) -> bool:
    source_words = len(source.split())
    if source_words < _MIN_SOURCE_WORDS_TO_CHECK:
        return False
    return len(candidate.split()) < source_words * _MIN_LENGTH_RATIO


def suggest(text: str) -> str | None:
    """Return a more natural French phrasing of `text`, or None if it's already natural
    (or if no attempt reliably preserved everything the learner said — see
    _looks_truncated)."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"<<<{text}>>>"},
    ]
    for _ in range(3):
        reply = llm.chat(messages, options={"temperature": 0.2}).strip("<>").strip()

        # Small models sometimes echo the source sentence before the verdict,
        # e.g. "…mes amis.>>> AUCUNE" — a trailing AUCUNE still means "no change".
        if not reply or re.search(r"\bAUCUNE\W*$", reply, re.IGNORECASE):
            return None
        if reply.strip(" .!\"'«»").lower() == text.strip(" .!\"'«»").lower():
            return None
        if not _looks_truncated(text, reply):
            return reply
    return None
