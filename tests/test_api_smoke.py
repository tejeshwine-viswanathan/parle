"""Smoke test for the core FastAPI endpoints (/health, /transcribe, /translate,
/tutor-respond, /speak) — the roleplay, topic-practice and phrasing endpoints
share the same plumbing and aren't repeated here.

Exercises the app in-process via FastAPI's TestClient, so no server needs to
be running. Requires Ollama running locally with the configured model
pulled, and the Piper voice model downloaded (see README). For the fast,
fully offline unit tests, run `python -m pytest tests/` instead.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from backend import tts
from backend.app import app

SEED_TEXT = "Bonjour, je m'appelle Claude et j'apprends le français."


def main() -> None:
    client = TestClient(app)

    print("0. GET /health")
    resp = client.get("/health")
    assert resp.status_code == 200, resp.text
    print(f"   -> {resp.json()}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        print(f"1. Synthesizing seed audio for: {SEED_TEXT!r}")
        seed_wav = tts.synthesize(SEED_TEXT, tmp_path / "seed.wav")
        assert seed_wav.exists() and seed_wav.stat().st_size > 0

        print("2. POST /transcribe")
        with open(seed_wav, "rb") as f:
            resp = client.post("/transcribe", files={"audio": ("seed.wav", f, "audio/wav")})
        assert resp.status_code == 200, resp.text
        transcription = resp.json()
        print(f"   -> {transcription['text']!r} (lang={transcription['language']}, "
              f"{len(transcription['notes'])} pronunciation notes)")
        assert transcription["text"]
        assert "notes" in transcription
        assert transcription["language"] == "fr"

        print("3. POST /translate (fr-en)")
        resp = client.post(
            "/translate", json={"text": transcription["text"], "direction": "fr-en"}
        )
        assert resp.status_code == 200, resp.text
        translation = resp.json()["translation"]
        print(f"   -> {translation!r}")
        assert translation

        print("4. POST /tutor-respond")
        resp = client.post(
            "/tutor-respond", json={"history": [], "user_text": transcription["text"]}
        )
        assert resp.status_code == 200, resp.text
        reply = resp.json()["reply"]
        print(f"   -> {reply!r}")
        assert reply

        print("5. POST /speak")
        resp = client.post("/speak", json={"text": reply})
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "audio/wav"
        assert len(resp.content) > 0
        print(f"   -> received {len(resp.content)} bytes of audio")

    print("\nAll endpoints OK: /health, /transcribe, /translate, /tutor-respond, /speak")


if __name__ == "__main__":
    main()
