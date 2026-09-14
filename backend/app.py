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

from . import config, grammar, phrasing, pronunciation, stt, translate, tts, tutor

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


class ScenarioStartRequest(BaseModel):
    scenario: str


class ScenarioRespondRequest(BaseModel):
    scenario: str
    history: list[Message] = []
    user_text: str


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None


class VoiceInfo(BaseModel):
    id: str
    label: str
    gender: str


class TopicStartRequest(BaseModel):
    topic: str
    target_minutes: float = 3


class TopicNudgeRequest(BaseModel):
    topic: str
    history: list[Message] = []


class TopicReplyResponse(BaseModel):
    reply: str


class TopicCompleteRequest(BaseModel):
    topic: str
    history: list[Message] = []
    remaining_minutes: float = 1


class TopicCompleteResponse(BaseModel):
    completion: str


class TopicReviewRequest(BaseModel):
    texts: list[str]


class ReviewSegment(BaseModel):
    text: str
    wrong: bool


class ReviewCorrection(BaseModel):
    original: str
    corrected: str
    segments: list[ReviewSegment]
    has_errors: bool


class TopicReviewResponse(BaseModel):
    corrections: list[ReviewCorrection]


class TranscribeResponse(stt.Transcription):
    notes: list[pronunciation.PronunciationNote]


class PhrasingRequest(BaseModel):
    text: str


class PhrasingResponse(BaseModel):
    suggestion: str | None


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


@app.post("/scenario-start", response_model=TopicReplyResponse)
def scenario_start(req: ScenarioStartRequest) -> TopicReplyResponse:
    if not req.scenario.strip():
        raise HTTPException(status_code=422, detail="scenario must not be empty")
    reply = tutor.start_scenario(req.scenario)
    return TopicReplyResponse(reply=reply)


@app.post("/scenario-respond", response_model=TutorResponse)
def scenario_respond(req: ScenarioRespondRequest) -> TutorResponse:
    if not req.scenario.strip():
        raise HTTPException(status_code=422, detail="scenario must not be empty")
    if not req.user_text.strip():
        raise HTTPException(status_code=422, detail="user_text must not be empty")
    history = [message.model_dump() for message in req.history]
    reply = tutor.get_scenario_response(req.scenario, history, req.user_text)
    return TutorResponse(reply=reply)


@app.post("/speak")
def speak(req: SpeakRequest) -> FileResponse:
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="text must not be empty")

    output_dir = config.DATA_DIR / "tts_cache"
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=output_dir, delete=False) as tmp:
        output_path = Path(tmp.name)

    try:
        tts.synthesize(req.text, output_path, voice_id=req.voice)
    except FileNotFoundError as err:
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(err)) from err
    return FileResponse(
        output_path,
        media_type="audio/wav",
        filename="speech.wav",
        background=BackgroundTask(output_path.unlink),
    )


@app.post("/topic-complete", response_model=TopicCompleteResponse)
def topic_complete(req: TopicCompleteRequest) -> TopicCompleteResponse:
    if not req.topic.strip():
        raise HTTPException(status_code=422, detail="topic must not be empty")
    history = [message.model_dump() for message in req.history]
    completion = tutor.complete_monologue(req.topic, history, req.remaining_minutes)
    return TopicCompleteResponse(completion=completion)


@app.post("/topic-review", response_model=TopicReviewResponse)
def topic_review(req: TopicReviewRequest) -> TopicReviewResponse:
    corrections = [grammar.review(t) for t in req.texts if t.strip()]
    return TopicReviewResponse(corrections=corrections)


@app.post("/phrasing-suggestion", response_model=PhrasingResponse)
def phrasing_suggestion(req: PhrasingRequest) -> PhrasingResponse:
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="text must not be empty")
    return PhrasingResponse(suggestion=phrasing.suggest(req.text))


@app.get("/voices", response_model=list[VoiceInfo])
def list_voices() -> list[VoiceInfo]:
    return [VoiceInfo(id=v.id, label=v.label, gender=v.gender) for v in tts.list_voices()]


@app.post("/topic-start", response_model=TopicReplyResponse)
def topic_start(req: TopicStartRequest) -> TopicReplyResponse:
    if not req.topic.strip():
        raise HTTPException(status_code=422, detail="topic must not be empty")
    reply = tutor.start_topic(req.topic, req.target_minutes)
    return TopicReplyResponse(reply=reply)


@app.post("/topic-nudge", response_model=TopicReplyResponse)
def topic_nudge(req: TopicNudgeRequest) -> TopicReplyResponse:
    if not req.topic.strip():
        raise HTTPException(status_code=422, detail="topic must not be empty")
    history = [message.model_dump() for message in req.history]
    reply = tutor.nudge_topic(req.topic, history)
    return TopicReplyResponse(reply=reply)
