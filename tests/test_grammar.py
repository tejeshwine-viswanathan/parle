"""Offline tests for the grammar-review parsing and patching logic — the parts
that turn the model's FAUX/CORRECT lines into verified corrections. No Ollama
needed: the one model call is stubbed."""

from __future__ import annotations

import pytest

from backend import grammar


class TestParseFixes:
    def test_aucune_means_no_fixes(self):
        assert grammar.parse_fixes("Je suis allé au parc.", "AUCUNE") == []
        assert grammar.parse_fixes("Je suis allé au parc.", "  aucune. ") == []
        assert grammar.parse_fixes("Je suis allé au parc.", "") == []

    def test_parses_one_fix_per_line(self):
        raw = "FAUX: je mange => CORRECT: j'ai mangé\nFAUX: je regardé => CORRECT: j'ai regardé"
        fixes = grammar.parse_fixes("Hier, je mange une pomme et je regardé la télé.", raw)
        assert fixes == [("je mange", "j'ai mangé"), ("je regardé", "j'ai regardé")]

    def test_drops_spans_not_in_source(self):
        raw = "FAUX: nous mangeons => CORRECT: nous avons mangé"
        assert grammar.parse_fixes("Hier, je mange une pomme.", raw) == []

    def test_drops_wholesale_rewrites(self):
        text = "Hier je suis allé au marché avec mon frère"
        raw = f"FAUX: {text} => CORRECT: Hier, je suis allée au marché avec mon frère."
        assert grammar.parse_fixes(text, raw) == []

    def test_drops_tu_to_vous_shift(self):
        raw = "FAUX: tu es => CORRECT: vous êtes"
        assert grammar.parse_fixes("Est-ce que tu es fatigué ?", raw) == []

    def test_ignores_noise_lines(self):
        raw = "Voici les fautes :\nFAUX: trois chat => CORRECT: trois chats\nMerci !"
        assert grammar.parse_fixes("Elle a trois chat.", raw) == [("trois chat", "trois chats")]

    def test_strips_quotes_around_spans(self):
        raw = 'FAUX: "trois chat" => CORRECT: "trois chats"'
        assert grammar.parse_fixes("Elle a trois chat.", raw) == [("trois chat", "trois chats")]


class TestApplyFixes:
    def test_substitutes_and_marks_segments(self):
        corrected, segments = grammar._apply_fixes(
            "Elle a trois chat et un chien.", [("trois chat", "trois chats")]
        )
        assert corrected == "Elle a trois chats et un chien."
        wrong = [s["text"] for s in segments if s["wrong"]]
        right = [s["text"] for s in segments if not s["wrong"]]
        assert wrong == ["trois", "chat"]
        assert right == ["Elle", "a", "et", "un", "chien."]

    def test_no_fixes_is_identity(self):
        corrected, segments = grammar._apply_fixes("Bonjour tout le monde.", [])
        assert corrected == "Bonjour tout le monde."
        assert all(not s["wrong"] for s in segments)
        assert [s["text"] for s in segments] == ["Bonjour", "tout", "le", "monde."]

    def test_overlapping_fixes_keep_first(self):
        corrected, _ = grammar._apply_fixes(
            "je mange une pomme", [("je mange", "j'ai mangé"), ("mange une", "mangé une")]
        )
        assert corrected == "j'ai mangé une pomme"

    def test_multiple_fixes_in_source_order(self):
        corrected, _ = grammar._apply_fixes(
            "Hier, je mange une pomme et je regardé la télé.",
            [("je regardé", "j'ai regardé"), ("je mange", "j'ai mangé")],
        )
        assert corrected == "Hier, j'ai mangé une pomme et j'ai regardé la télé."


class TestReview:
    @pytest.fixture
    def fake_chat(self, monkeypatch):
        """Stub llm.chat with a per-sentence answer map."""
        answers: dict[str, str] = {}

        def chat(messages, **_):
            sentence = messages[-1]["content"].strip("<>")
            return answers.get(sentence, "AUCUNE")

        monkeypatch.setattr(grammar.llm, "chat", chat)
        return answers

    def test_reviews_sentence_by_sentence(self, fake_chat):
        fake_chat["Elle a trois chat."] = "FAUX: trois chat => CORRECT: trois chats"
        result = grammar.review("Je suis allé au parc. Elle a trois chat.")
        assert result["has_errors"] is True
        assert result["corrected"] == "Je suis allé au parc. Elle a trois chats."
        assert result["original"] == "Je suis allé au parc. Elle a trois chat."

    def test_correct_text_has_no_errors(self, fake_chat):
        result = grammar.review("Je suis allé au parc.")
        assert result["has_errors"] is False
        assert result["corrected"] == result["original"]
