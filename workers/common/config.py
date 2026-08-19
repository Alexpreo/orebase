"""Typed application settings loaded from the environment (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(default="", alias="DATABASE_URL")

    s3_bucket: str = Field(default="", alias="S3_BUCKET")
    aws_region: str = Field(default="us-east-1", alias="AWS_REGION")
    aws_access_key_id: str = Field(default="", alias="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field(default="", alias="AWS_SECRET_ACCESS_KEY")

    # OCR backend for low-text pages: "none", "textract", or "tesseract". Defaults to none
    # so a document still indexes its extractable text when no OCR provider is reachable;
    # a page that cannot be read is recorded as unread rather than failing the document.
    ocr_backend: str = Field(default="none", alias="OCR_BACKEND")

    voyage_api_key: str = Field(default="", alias="VOYAGE_API_KEY")
    # 0 uses the embedder's free-tier-safe default. Raise it once the Voyage account has a
    # payment method to send fewer, larger embedding requests.
    voyage_max_tokens_per_request: int = Field(
        default=0, alias="VOYAGE_MAX_TOKENS_PER_REQUEST"
    )
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")

    # SEC requires a declared User-Agent that identifies the app and a contact email.
    edgar_user_agent: str = Field(
        default="OreBase/0.1 (contact@example.com)", alias="EDGAR_USER_AGENT"
    )

    # Gate diagnostic logging so it never runs in production. See the Dev Diagnostics rule.
    debug: bool = Field(default=False, alias="DEBUG")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
