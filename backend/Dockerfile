# NOVA backend. Voice (self-hosted Kokoro TTS) is an optional layer: build with
#   docker build --build-arg WITH_VOICE=0 .   for a small image with no voice (text-only Guide).
# The default includes it; see README-voice.md for the size/RAM implications (the CPU torch wheel alone
# is several hundred MB, and the model is ~330 MB more at first run).
FROM python:3.12-slim

ARG WITH_VOICE=1
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface

# libsndfile/espeak-ng: Kokoro's phonemizer normally uses the espeak-ng library bundled in the Python
# wheel (espeakng-loader); the system package is the supported fallback on platforms without that wheel.
RUN if [ "$WITH_VOICE" = "1" ]; then apt-get update && apt-get install -y --no-install-recommends espeak-ng libsndfile1 \
    && rm -rf /var/lib/apt/lists/*; fi

WORKDIR /app
COPY pyproject.toml constraints-voice.txt ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY scripts ./scripts
RUN pip install . \
    && if [ "$WITH_VOICE" = "1" ]; then pip install --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple -c constraints-voice.txt ".[voice]" \
    && python -m spacy download en_core_web_sm; fi

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
