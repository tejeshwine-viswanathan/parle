"""Offline tests for pronunciation flagging and tip selection."""

from __future__ import annotations

from backend import pronunciation


def word(text: str, probability: float) -> pronunciation.Word:
    return {"word": text, "start": 0.0, "end": 0.5, "probability": probability}


class TestIsFlagged:
    def test_low_confidence_content_word(self):
        assert pronunciation._is_flagged(word("bonjour", 0.3))

    def test_confident_word_not_flagged(self):
        assert not pronunciation._is_flagged(word("bonjour", 0.95))

    def test_short_words_skipped(self):
        assert not pronunciation._is_flagged(word("je", 0.1))
        assert not pronunciation._is_flagged(word("à", 0.1))

    def test_common_function_words_skipped(self):
        assert not pronunciation._is_flagged(word("que", 0.1))
        assert not pronunciation._is_flagged(word("Mais,", 0.1))
        assert not pronunciation._is_flagged(word("pour", 0.1))

    def test_punctuation_stripped_before_length_check(self):
        assert not pronunciation._is_flagged(word("et.", 0.1))


class TestTipFor:
    def test_known_patterns_win_in_order(self):
        assert "'ou'" in pronunciation._tip_for("vous")
        assert "'oi'" in pronunciation._tip_for("moi")
        assert "'gn'" in pronunciation._tip_for("montagne")
        assert "'ç'" in pronunciation._tip_for("français")
        assert "silent" in pronunciation._tip_for("hôtel")

    def test_fallback_asks_model(self, monkeypatch):
        calls: list[str] = []

        def chat(messages, **_):
            calls.append(messages[-1]["content"])
            return "Say it softly."

        monkeypatch.setattr(pronunciation.llm, "chat", chat)
        # No vowel/consonant pattern matches a word like this.
        assert pronunciation._tip_for("xyz") == "Say it softly."
        assert calls and "xyz" in calls[0]


def test_analyze_only_notes_flagged_words(monkeypatch):
    monkeypatch.setattr(pronunciation.llm, "chat", lambda *_a, **_k: "tip")
    transcription: pronunciation.Transcription = {
        "text": "Bonjour, je voudrais un croissant.",
        "language": "fr",
        "language_probability": 0.99,
        "words": [
            word("Bonjour,", 0.9),
            word("je", 0.2),
            word("voudrais", 0.4),
            word("un", 0.2),
            word("croissant.", 0.95),
        ],
    }
    notes = pronunciation.analyze(transcription)
    assert [n["word"] for n in notes] == ["voudrais"]
    assert notes[0]["tip"]
