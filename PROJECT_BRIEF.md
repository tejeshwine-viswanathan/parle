# Parlé — Bilingual French Voice Tutor
### Project Brief & Requirements (v1) — feed this to Claude Code to bootstrap the repo

---

## 1. Vision

A free, open-source, privacy-first, voice-to-voice French tutor. It runs entirely on the user's machine, on local models only (Ollama for language tasks, local speech models for STT/TTS). No cloud LLM calls, no API keys, no personal data or audio ever leaves the machine.

## 2. Core User Stories

- As a learner, I hold a button and speak French. I see a live transcript, its English translation, and specific pronunciation notes on what I got wrong.
- As a learner, the tutor replies out loud in French, and either asks me a follow-up question or gives me a new prompt to keep talking — so the conversation never stalls.
- As a learner, I can tap a button to reveal the English translation of anything the tutor said or asked, but by default I only see/hear French, so I'm forced to practice comprehension.
- As a learner, when I'm unsure how to say something, I switch to a second tab, type or speak it in English, and the app shows me and speaks the French translation back to me.
- As a learner, I want a UI that feels light, bright, and doesn't get in the way of a spoken conversation.

## 3. Feature Spec

### 3.1 Practice tab (speak French → get corrected)
- Hold-to-talk mic button (press and hold to record, release to send — not a toggle).
- Speech-to-text transcription of the French audio.
- Side-by-side display: French transcript + English translation.
- Pronunciation feedback: flag specific words/sounds that were likely mispronounced, with a plain-language tip (e.g. "the 'u' in 'tu' — round your lips more, it's not 'oo'").
- Tutor responds in spoken French (with text shown), and either asks a follow-up question or gives a new conversation prompt, to keep the practice going.
- "Show English" toggle (off by default) reveals the English translation of the tutor's spoken French — for the current turn and retroactively in history.

### 3.2 Translate-to-learn tab (English → French)
- Type or speak an English phrase you don't know how to say.
- App shows and speaks the French translation.
- Optional: simple phonetic guide alongside the French text.

### 3.3 Cross-cutting requirements
- Hold-to-speak mic UI is consistent across both tabs.
- Every piece of spoken output always has a corresponding text version available — nothing is audio-only.
- Session history is stored locally only, and can be cleared with one click.

## 4. Non-Functional Requirements

- **Fully local:** speech-to-text, text-to-speech, and the conversational model all run locally via Ollama + open-source models. No API keys, no cloud calls, no cost to use the app, ever.
- **Privacy:** no personal data, recordings, or transcripts ever leave the user's machine. No analytics, no telemetry.
- **Open source:** MIT-licensed, and buildable by anyone via `git clone` + a single setup script.
- **Cross-platform:** macOS / Linux / Windows, via Docker Compose or native install.

## 5. Tech Stack by Feature

| Feature | Tech | Why |
|---|---|---|
| Speech-to-text (French) | `faster-whisper` (Whisper via CTranslate2), small/medium French model | Free, open-source, runs well on CPU, strong French accuracy |
| Text translation (FR↔EN) | Local LLM via **Ollama** (e.g. Llama 3.1 8B or Mistral), or **Argos Translate** for a lightweight dedicated offline option | Ollama is already installed; Argos is a purpose-built free offline MT engine if you want translation to be faster/cheaper than a full LLM call |
| Conversational tutor (questions, prompts, feedback wording) | **Ollama** local model only | $0 cost, fully offline, no external dependency at all |
| Pronunciation issue detection | `faster-whisper` word-level confidence scores + grapheme-to-phoneme comparison (`epitran` or `phonemizer`) | Best available free/local approach — flag this as "best-effort" coaching, not lab-grade phonetic scoring |
| Text-to-speech (French) | **Piper TTS** (or Coqui TTS as a fallback) | Free, open-source, fast on CPU, natural-sounding French voices |
| Frontend UI | React + Vite + TailwindCSS | Clean, modern, easy to make bright/minimal |
| Backend / orchestration | Python + FastAPI | Best ecosystem for gluing together Whisper, Piper, and Ollama |
| Hold-to-speak recording | Browser `MediaRecorder` / Web Audio API | No native app needed, works in any modern browser |
| Local data storage | SQLite or local JSON files | Zero cloud dependency, user owns their data |
| Packaging / distribution | Docker Compose + `setup.sh`, plus a plain `pip`/`npm` path | "Clone and run" for anyone who finds the repo |
| Secrets management | `.env` + `python-dotenv`, gitignored, `.env.example` committed | Standard, well-understood, safe by default |
| License | MIT | Fully open, anyone can use or fork it |

## 6. Repository Structure

```
parle/
  README.md
  PROJECT_BRIEF.md        <- this document
  ARCHITECTURE.md
  LICENSE                 (MIT)
  .env.example
  .gitignore
  docker-compose.yml
  backend/
    app.py                (FastAPI entrypoint)
    stt.py                (faster-whisper wrapper)
    tts.py                (Piper wrapper)
    translate.py          (Ollama/Argos translation)
    tutor.py              (conversation orchestration — Ollama only)
    pronunciation.py       (confidence + phoneme comparison)
    requirements.txt
  frontend/
    package.json
    src/
      tabs/Practice.tsx
      tabs/Translate.tsx
      components/HoldToTalkButton.tsx
  scripts/
    setup.sh
  tests/
```

## 7. Security & Privacy Checklist

- [ ] `.env` is gitignored; never committed
- [ ] `.env.example` ships with placeholder values only
- [ ] No hard-coded keys anywhere in source
- [ ] No analytics or telemetry of any kind
- [ ] All audio/transcripts stored locally; one-click purge
- [ ] README states clearly: "Your data never leaves your machine. No cloud calls, no API keys, ever."

## 8. Build Plan (for iterating with Claude Code)

1. Init repo with this brief + `ARCHITECTURE.md`.
2. Scaffold the backend and verify the local pipeline end-to-end via CLI (record → STT → translate → TTS) before touching the UI.
3. Build FastAPI endpoints: `/transcribe`, `/translate`, `/tutor-respond`, `/speak`.
4. Scaffold the React frontend; wire the hold-to-talk button to the backend.
5. Add the pronunciation feedback module.
6. Add the Translate-to-learn tab.
7. Polish the UI (bright, clean visual theme).
8. Write the README, setup script, and Docker Compose file.
9. Manual QA pass, then iterate based on your own usage feedback.

## 9. Open Decisions

- Local LLM size (7B vs 8B vs smaller) — depends on your machine's RAM/VRAM.
- French dialect for TTS voice (France vs Québécois).
- Streaming responses vs. clip-based turns for the MVP (clip-based is much simpler to start with).


