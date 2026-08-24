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
    extract_haiku_model: str = Field(default="claude-haiku-4-5", alias="EXTRACT_HAIKU_MODEL")
    extract_sonnet_model: str = Field(
        default="claude-sonnet-4-5", alias="EXTRACT_SONNET_MODEL"
    )
    # Hard stop before claiming an extract job. Defaults match the Phase 3 bring-up caps.
    extraction_daily_cap_usd: float = Field(default=5.0, alias="EXTRACTION_DAILY_CAP_USD")
    extraction_monthly_cap_usd: float = Field(
        default=50.0, alias="EXTRACTION_MONTHLY_CAP_USD"
    )
    # Full numeric extract auto-runs for watchlisted entities and filings newer than this.
    extract_auto_months: int = Field(default=18, alias="EXTRACT_AUTO_MONTHS")
    extract_use_batch: bool = Field(default=False, alias="EXTRACT_USE_BATCH")

    # SEC requires a declared User-Agent that identifies the app and a contact email.
    edgar_user_agent: str = Field(
        default="OreBase/0.1 (contact@example.com)", alias="EDGAR_USER_AGENT"
    )

    sedar_profile_dir: str = Field(default="~/.sedar_profile", alias="SEDAR_PROFILE_DIR")
    sedar_headful: bool = Field(default=False, alias="SEDAR_HEADFUL")
    sedar_daily_fetch_cap: int = Field(default=20, alias="SEDAR_DAILY_FETCH_CAP")
    sedar_search_url: str = Field(
        default="https://www.sedarplus.ca/csa-party/viewInstance/view.html?id=0c11f8b7998bcd96fb9cb36b800b9dfdd7cbf07b7cf2bde3",
        alias="SEDAR_SEARCH_URL",
    )
    sedar_alert_webhook_secret: str = Field(default="", alias="SEDAR_ALERT_WEBHOOK_SECRET")
    sedar_json_search_url: str = Field(default="", alias="SEDAR_JSON_SEARCH_URL")
    sedar_json_search_method: str = Field(default="POST", alias="SEDAR_JSON_SEARCH_METHOD")
    sedar_json_search_body: str = Field(default="", alias="SEDAR_JSON_SEARCH_BODY")
    sedar_page_size: int = Field(default=30, alias="SEDAR_PAGE_SIZE")
    sedar_challenge_sns_arn: str = Field(default="", alias="SEDAR_CHALLENGE_SNS_ARN")
    ssm_prefix: str = Field(default="", alias="SSM_PREFIX")

    resend_api_key: str = Field(default="", alias="RESEND_API_KEY")
    alert_from_email: str = Field(default="", alias="ALERT_FROM_EMAIL")

    newswire_feeds: str = Field(
        default=(
            "https://www.globenewswire.com/RssFeed/subjectcode/26-Mining/feedTitle/GlobeNewswire%20-%20Mining,"
            "https://www.newsfilecorp.com/rss/newsfile-all"
        ),
        alias="NEWSWIRE_FEEDS",
    )

    cloudwatch_namespace: str = Field(default="OreBase", alias="CLOUDWATCH_NAMESPACE")
    cloudwatch_metrics: bool = Field(default=False, alias="CLOUDWATCH_METRICS")

    # Gate diagnostic logging so it never runs in production. See the Dev Diagnostics rule.
    debug: bool = Field(default=False, alias="DEBUG")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
