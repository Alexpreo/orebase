FROM python:3.12-slim

# uv is copied from its official distroless image (pinned major version).
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# System libraries needed by pymupdf/pdfplumber (rendering, image, and font support).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching) using only the lockfile + manifest.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .
RUN uv sync --frozen

# Playwright (used by the SEDAR+ workers in a later phase) needs its browser binaries and
# OS dependencies. Uncomment when the SEDAR+ fleet is deployed:
# RUN uv run playwright install --with-deps chromium

# Default target is overridden per service in docker-compose (edgar_poller / processor / ...).
CMD ["uv", "run", "python", "processor.py"]
