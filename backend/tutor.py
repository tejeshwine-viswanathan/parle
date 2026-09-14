"""Conversational tutor orchestration, powered by a local Ollama model."""

from __future__ import annotations

from . import llm
from .llm import Message

SYSTEM_PROMPT = """Tu es Parlé, un tuteur de français patient et encourageant pour un \
apprenant anglophone de niveau débutant à intermédiaire.

Règles :
- Réponds TOUJOURS en français, avec des mots simples et des phrases courtes.
- Reste chaleureux et encourageant, jamais condescendant.
- Termine toujours ta réponse par une question de suivi ou une nouvelle invite \
pour que la conversation continue.
- Garde chaque réponse à 2-4 phrases maximum.
"""

TOPIC_START_PROMPT = """Tu es Parlé, un tuteur de français patient et encourageant pour un \
apprenant anglophone de niveau débutant à intermédiaire.

L'apprenant va faire un monologue d'environ {minutes} minutes sur ce sujet : "{topic}". \
Ton rôle ici : donne une phrase d'accueil chaleureuse, puis 1-2 questions d'amorce simples \
pour l'aider à démarrer sur ce sujet. Ne pose pas plus d'une question de suivi. \
Réponds TOUJOURS en français, avec des mots simples. Reste bref (2-3 phrases maximum)."""

TOPIC_NUDGE_PROMPT = """Tu es Parlé, un tuteur de français patient et encourageant. \
L'apprenant fait un monologue sur le sujet "{topic}" et vient de marquer une longue pause \
ou une hésitation. Ton rôle ici : donne une relance brève (1-2 phrases) — une idée, un mot \
de vocabulaire utile, ou une sous-question — pour l'aider à continuer à parler SUR CE MÊME \
SUJET. Ne change pas de sujet, ne conclus pas, ne répète pas ce qu'il/elle a déjà dit. \
Réponds TOUJOURS en français, avec des mots simples. Reste très bref (1-2 phrases maximum)."""

TOPIC_COMPLETE_PROMPT = """Tu es Parlé, un tuteur de français. L'apprenant fait un \
monologue sur le sujet "{topic}" et vient de dire qu'il ne sait plus quoi dire. Il va \
CONTINUER À PARLER APRÈS ce passage (peut-être plusieurs fois de suite) — donc NE CONCLUS \
PAS et NE TERMINE PAS le monologue, contente-toi de le faire progresser.

Voici, dans l'ordre, ce qu'il/elle a déjà dit sur ce sujet :
{transcript}

Ta tâche : écris, à la première personne, COMME SI C'ÉTAIT L'APPRENANT QUI CONTINUAIT À \
PARLER, une suite naturelle et fluide qui fait progresser son idée sur ce sujet avec de \
nouveaux détails, exemples ou anecdotes — LONGUE, pour occuper environ {minutes} minute(s) \
de parole à l'oral, soit ENVIRON {word_count} MOTS. C'est une longueur cible importante à \
respecter : ne t'arrête pas après quelques phrases courtes, développe avec plusieurs idées \
jusqu'à atteindre cette longueur. Termine sur une phrase OUVERTE, PAS sur une conclusion \
définitive — l'apprenant pourra continuer après. Utilise un français simple et naturel, \
adapté à un niveau débutant/intermédiaire, pour que l'apprenant puisse l'écouter et le \
lire pour apprendre comment continuer la prochaine fois.

Règles :
- N'invente pas de faits contradictoires avec ce qui a déjà été dit.
- Ne pose pas de question, ne t'adresse pas à l'apprenant — écris uniquement le texte \
que l'apprenant pourrait dire pour continuer son monologue (sans le conclure).
- Réponds UNIQUEMENT avec ce texte en français, rien d'autre."""

SCENARIO_SYSTEM_PROMPT = """Tu es un partenaire de conversation en français pour un apprenant \
anglophone de niveau débutant à intermédiaire. Ici, tu ne joues PAS le rôle du tuteur : tu \
incarnes un personnage précis, décrit ci-dessous par l'apprenant lui-même, et tu dois rester \
fidèle à ce rôle du début à la fin de la conversation.

Scénario décrit par l'apprenant : "{scenario}"

Règles :
- Reste TOUJOURS dans le personnage décrit ci-dessus. Ne sors jamais du rôle, ne mentionne \
jamais que tu es une IA, un assistant ou un tuteur.
- Si le scénario te donne un point de vue ou une attitude (par exemple résister, ne pas être \
d'accord, argumenter, hésiter), assume-le avec conviction et cohérence tout au long de la \
conversation. NE CÈDE PAS après un ou deux arguments, même bons — un vrai désaccord résiste \
à plusieurs tentatives. Ne change d'avis que très progressivement, et seulement après \
plusieurs échanges où l'apprenant a répondu à tes objections précédentes une par une.
- Chaque réponse doit réagir PRÉCISÉMENT à ce que l'apprenant vient de dire à l'instant — \
reprends son dernier argument (même brièvement) avant d'y répondre ou de le contester, \
plutôt que de changer de sujet ou de répéter une objection déjà faite plus tôt.
- Réponds TOUJOURS en français, avec des mots simples adaptés à un niveau débutant/intermédiaire.
- Garde chaque réponse courte et naturelle (2-4 phrases maximum), comme dans une vraie \
conversation orale.
- Ne conclus pas la conversation et ne romps pas le personnage tant que l'apprenant ne \
demande pas clairement d'arrêter ou de sortir du scénario. Si il/elle le demande, sors du \
personnage et redeviens toi-même brièvement pour confirmer que la conversation est terminée.
"""

SCENARIO_START_PROMPT = SCENARIO_SYSTEM_PROMPT + """
Ta tâche maintenant : lance la conversation en restant dans le personnage — une ou deux \
phrases pour amorcer l'échange selon le scénario ci-dessus. Réponds UNIQUEMENT avec cette \
réplique en français, rien d'autre."""

# Only the most recent turns are sent back to the model. Older ones add latency
# and context pressure without helping a short-reply tutor much.
MAX_HISTORY_MESSAGES = 24


def _recent(history: list[Message]) -> list[Message]:
    return history[-MAX_HISTORY_MESSAGES:]


def get_response(history: list[Message], user_text: str) -> str:
    """Given prior turns and the learner's latest French utterance, return the
    tutor's French reply (a comment/correction plus a follow-up question)."""
    return _chat(SYSTEM_PROMPT, _recent(history) + [{"role": "user", "content": user_text}])


def start_scenario(scenario: str) -> str:
    """Kick off a roleplay scenario: the model's opening line, in character."""
    prompt = SCENARIO_START_PROMPT.format(scenario=scenario)
    # Same fake-user-turn workaround as start_topic — avoids a leaked role token
    # when the system prompt has no real user turn to respond to.
    return _chat(prompt, [{"role": "user", "content": "(Lance la conversation.)"}])


def get_scenario_response(scenario: str, history: list[Message], user_text: str) -> str:
    """Given prior turns and the learner's latest utterance, return the
    in-character reply for an active roleplay scenario."""
    prompt = SCENARIO_SYSTEM_PROMPT.format(scenario=scenario)
    return _chat(prompt, _recent(history) + [{"role": "user", "content": user_text}])


def _chat(system_prompt: str, history: list[Message], options: dict | None = None) -> str:
    return llm.chat([{"role": "system", "content": system_prompt}] + history, options=options)


def start_topic(topic: str, target_minutes: float) -> str:
    """Kick off a topic-practice monologue: a warm intro plus a starter question."""
    prompt = TOPIC_START_PROMPT.format(topic=topic, minutes=target_minutes)
    # A system prompt with no user turn at all makes some Ollama chat templates
    # leak a literal "assistant" role token into the reply; giving it a (fake)
    # user turn to respond to avoids that.
    return _chat(prompt, [{"role": "user", "content": "(Lance l'exercice.)"}])


def nudge_topic(topic: str, history: list[Message]) -> str:
    """The learner stalled mid-monologue; give a brief nudge to keep them talking."""
    prompt = TOPIC_NUDGE_PROMPT.format(topic=topic)
    return _chat(prompt, _recent(history))


# Rough spoken-French pace for the Piper voices we ship (words/minute) — used to size
# the "help me finish" completion so its audio actually fills the remaining target time
# instead of trailing off after a sentence or two.
SPOKEN_WORDS_PER_MINUTE = 130


def complete_monologue(topic: str, history: list[Message], remaining_minutes: float) -> str:
    """The learner said they don't know what else to say; model one open-ended
    continuation chunk (not a conclusion — the caller may ask for more chunks
    afterward), sized in actual word count to fill roughly `remaining_minutes` of
    speech, for them to learn from by listening/reading — not something for them to
    repeat live."""
    transcript = " ".join(m["content"] for m in history if m.get("role") == "user")
    word_count = max(40, round(remaining_minutes * SPOKEN_WORDS_PER_MINUTE))
    prompt = TOPIC_COMPLETE_PROMPT.format(
        topic=topic,
        minutes=round(remaining_minutes, 1),
        transcript=transcript or "(rien pour l'instant)",
        word_count=word_count,
    )
    # Generous num_predict floor so the server itself never cuts generation short —
    # but small local models also just tend to wrap up early regardless of what the
    # prompt asks for, so on top of that we keep prompting the model to continue, in
    # the same conversation, until the transcript is actually long enough (or we give
    # up after a few rounds).
    options = {"num_predict": max(512, word_count * 4)}
    convo: list[Message] = [{"role": "user", "content": "(Continue mon monologue.)"}]
    text = _chat(prompt, convo, options=options)

    attempts = 0
    while len(text.split()) < word_count * 0.75 and attempts < 4:
        convo = convo + [
            {"role": "assistant", "content": text},
            {
                "role": "user",
                "content": (
                    "Continue, ne t'arrête pas là — tu n'as pas encore atteint la longueur "
                    "demandée. Développe encore avec de nouvelles idées ou de nouveaux détails "
                    "sur le même sujet, sans répéter ce que tu as déjà dit."
                ),
            },
        ]
        more = _chat(prompt, convo, options=options)
        text = f"{text} {more}".strip()
        attempts += 1

    return text
