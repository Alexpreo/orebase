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
    # One model for every extraction schema; numeric tables that come back below the
    # escalation threshold are re-extracted with the stronger model.
    extract_model: str = Field(default="claude-sonnet-5-5", alias="EXTRACT_MODEL")
    extract_escalation_model: str = Field(
        default="claude-opus-5-5", alias="EXTRACT_ESCALATION_MODEL"
    )
    extract_escalate_below: float = Field(default=0.7, alias="EXTRACT_ESCALATE_BELOW")
    # Monthly spend is a hard stop before claiming. Daily spend only alerts (never halts).
    extraction_monthly_cap_usd: float = Field(
        default=80.0, alias="EXTRACTION_MONTHLY_CAP_USD"
    )
    extraction_daily_alert_usd: float = Field(
        default=15.0, alias="EXTRACTION_DAILY_ALERT_USD"
    )
    # Full numeric extract auto-runs for watchlisted entities and filings newer than this.
    extract_auto_months: int = Field(default=18, alias="EXTRACT_AUTO_MONTHS")
    extract_use_batch: bool = Field(default=False, alias="EXTRACT_USE_BATCH")
    # Backfill tier: filings older than EXTRACT_AUTO_MONTHS. Haiku reads triage, resources
    # and QPs (matched Sonnet on grades in a 10-report test); Sonnet reads economics and
    # drills and re-checks any Haiku row below EXTRACT_ESCALATE_BELOW. Always via Batch (50% off).
    backfill_model: str = Field(default="claude-haiku-5-5", alias="BACKFILL_MODEL")
    backfill_numeric_model: str = Field(
        default="claude-sonnet-5-5", alias="BACKFILL_NUMERIC_MODEL"
    )

    # SEC requires a declared User-Agent that identifies the app and a contact email.
    edgar_user_agent: str = Field(
        default="OreBase/0.1 (contact@example.com)", alias="EDGAR_USER_AGENT"
    )

    sedar_profile_dir: str = Field(default="~/.sedar_profile", alias="SEDAR_PROFILE_DIR")
    sedar_headful: bool = Field(default=False, alias="SEDAR_HEADFUL")
    sedar_daily_fetch_cap: int = Field(default=20, alias="SEDAR_DAILY_FETCH_CAP")
    sedar_search_url: str = Field(
        default=(
            "https://www.sedarplus.ca/csa-party/service/create.html"
            "?targetAppCode=csa-party&service=searchDocuments&_locale=en"
        ),
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
            "https://www.globenewswire.com/RssFeed/industry/1777-Gold%20Mining/feedTitle/GlobeNewswire%20-%20Industry%20News%20on%20Gold%20Mining,"
            "https://www.globenewswire.com/RssFeed/industry/1775-General%20Mining/feedTitle/GlobeNewswire%20-%20Industry%20News%20on%20General%20Mining,"
            "https://feeds.newsfilecorp.com/industry/mining-metals"
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
