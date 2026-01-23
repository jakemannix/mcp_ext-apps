# Cloud Run Dockerfile for Say Server
# Uses uv for fast Python package management

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Install git for pip install from git repos
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server file
COPY server.py .

# Use isolated cache directory for HuggingFace to avoid permission issues
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

# Pre-install dependencies for faster cold starts
RUN uv pip install --system --default-index https://pypi.org/simple \
    "mcp @ git+https://github.com/modelcontextprotocol/python-sdk@main" \
    "uvicorn>=0.34.0" \
    "starlette>=0.46.0" \
    "pocket-tts>=1.0.1"

# Cloud Run sets PORT env var, server already respects it
# Default to 8080 for Cloud Run
ENV PORT=8080
ENV HOST=0.0.0.0

# Expose port (informational, Cloud Run uses PORT env var)
EXPOSE 8080

# Run the server directly with python (not uv run, since deps are pre-installed)
CMD ["python", "server.py"]
