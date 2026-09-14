# Build from the repo root (needs backend/ and scripts/):
#   docker build -f backend/Dockerfile -t parle-backend .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
# argostranslate depends on stanza -> torch; the default Linux torch wheel drags in
# several GB of CUDA libraries, so pin the CPU build first.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r backend/requirements.txt

# Bake every speech/translation model into the image so the container runs
# fully offline after the build. These are the only network fetches.
ARG WHISPER_MODEL_SIZE=small
RUN python -m piper.download_voices --download-dir backend/voices fr_FR-siwis-medium fr_FR-gilles-low
COPY scripts/install_translate_models.py scripts/install_translate_models.py
RUN python scripts/install_translate_models.py
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL_SIZE}', device='cpu', compute_type='int8')"

COPY backend/ backend/

ENV DATA_DIR=/app/data
EXPOSE 8000
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
