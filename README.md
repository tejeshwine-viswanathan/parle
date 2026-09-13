# Parlé

A free, open-source, voice-to-voice French tutor that runs entirely on your own machine. Talk in French, get transcribed, translated, and corrected on pronunciation — then have a real spoken conversation with an AI tutor that keeps prompting you to keep talking.

No API keys. No cloud calls. No accounts. Everything — speech recognition, translation, the tutor's conversation, and the voice that talks back — runs locally via [Ollama](https://ollama.com) and open-source speech models.

## Features

- **Hold-to-talk practice mode** — press and hold to speak French, release to send.
- **Live transcript + translation** — see what you said in French and English side by side.
- **Pronunciation feedback** — specific, plain-language notes on words or sounds you likely got wrong.
- **A tutor that actually converses** — it replies out loud in French and keeps asking follow-up questions or giving you new things to talk about.
- **Show English on demand** — everything the tutor says is available in English behind a toggle, hidden by default so you practice listening.
- **Translate-to-learn tab** — type or say something in English you don't know how to phrase, and hear it back in French.
- **100% local and private** — your voice, transcripts, and conversation history never leave your computer.

## How it works

```
Hold-to-talk mic  →  Speech-to-text  →  Tutor engine  →  Text-to-speech  →  You hear + see French
   (browser)         (faster-whisper)      (Ollama)          (Piper)
```

Full architecture and design decisions are in [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md).

## Prerequisites

- [Ollama](https://ollama.com) installed and running, with a model pulled:
  ```bash
  ollama pull llama3.1
  ```
- Python 3.10+
- Node.js 18+
- `ffmpeg` (for audio handling)

## Installation

```bash
git clone https://github.com/<your-username>/parle.git
cd parle
./scripts/setup.sh
```

The setup script installs backend and frontend dependencies and pulls the required speech models.

## Usage

```bash
docker compose up
```

or run backend and frontend separately during development — see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

Then open `http://localhost:5173` in your browser, pick a tab, and start talking.

### Current status: backend pipeline only

The frontend and FastAPI endpoints haven't been built yet. Right now you can exercise
the full local pipeline (record → speech-to-text → Ollama tutor → text-to-speech) from
the command line:

```bash
python -m venv .venv && source .venv/Scripts/activate  # or .venv/bin/activate on macOS/Linux
pip install -r backend/requirements.txt
python -m piper.download_voices --download-dir backend/voices fr_FR-siwis-medium
cp .env.example .env   # edit OLLAMA_MODEL to a model you've pulled, e.g. `ollama pull llama3.1`

python scripts/cli_pipeline.py
```

Press Enter to start recording, speak French, press Enter again to stop — the tutor's
spoken French reply plays back through your speakers. Ctrl+C to quit.

To sanity-check the pipeline without a microphone (useful for CI), run
`python tests/test_pipeline_smoke.py` — it synthesizes a French sentence, transcribes it
back, sends it to the tutor, and speaks the reply.

## Privacy

Parlé does not collect, transmit, or store your data anywhere but your own disk. There are no accounts, no analytics, and no network calls other than the ones your own Ollama instance makes locally. You can clear all saved history from the app at any time.

## Tech stack

Speech-to-text (faster-whisper), translation and conversation (Ollama), text-to-speech (Piper), backend (FastAPI), frontend (React + Vite + Tailwind) — all free and open source. See [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) for the full breakdown and rationale.

## Contributing

Issues and pull requests are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
