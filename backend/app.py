"""FastAPI entrypoint gluing together STT, translation, the tutor, and TTS.

Run from the repo root with the backend venv active:

    uvicorn backend.app:app --reload --port 8000
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from . import config, pronunciation, stt, translate, tts, tutor

app = FastAPI(title="Parlé backend")

# Local-only app; the frontend dev server runs on a different origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Message(BaseModel):
    role: str
    content: str


class TranslateRequest(BaseModel):
    text: str
    direction: translate.Direction


class TranslateResponse(BaseModel):
    translation: str


class TutorRequest(BaseModel):
    history: list[Message] = []
    user_text: str


class TutorResponse(BaseModel):
    reply: str


class SpeakRequest(BaseModel):
    text: str


class TranscribeResponse(stt.Transcription):
    notes: list[pronunciation.PronunciationNote]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile, language: str = Form("fr")) -> TranscribeResponse:
    """Transcribe an uploaded audio clip (French by default; the Translate-to-learn
    tab also sends English clips via `language=en`). French transcriptions also get
    best-effort pronunciation notes on words the model struggled with."""
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        tmp.write(await audio.read())

    try:
        transcription = stt.transcribe(tmp_path, language=language)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not transcription["text"]:
        raise HTTPException(status_code=422, detail="No speech recognized in audio")

    notes = pronunciation.analyze(transcription) if language == "fr" else []
    return {**transcription, "notes": notes}


@app.post("/translate", response_model=TranslateResponse)
def translate_text(req: TranslateRequest) -> TranslateResponse:
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="text must not be empty")
    translation = translate.translate(req.text, req.direction)
    return TranslateResponse(translation=translation)


@app.post("/tutor-respond", response_model=TutorResponse)
def tutor_respond(req: TutorRequest) -> TutorResponse:
    if not req.user_text.strip():
        raise HTTPException(status_code=422, detail="user_text must not be empty")
    history = [message.model_dump() for message in req.history]
    reply = tutor.get_response(history, req.user_text)
    return TutorResponse(reply=reply)


@app.post("/speak")
def speak(req: SpeakRequest) -> FileResponse:
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="text must not be empty")

    output_dir = config.DATA_DIR / "tts_cache"
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=output_dir, delete=False) as tmp:
        output_path = Path(tmp.name)

    tts.synthesize(req.text, output_path)
    return FileResponse(
        output_path,
        media_type="audio/wav",
        filename="speech.wav",
        background=BackgroundTask(output_path.unlink),
    )
