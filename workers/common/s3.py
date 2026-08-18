"""S3 wrapper for the document corpus. The bucket is assumed to have versioning enabled,
so re-uploading the same key keeps prior versions rather than destroying history."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import boto3

from .config import settings

logger = logging.getLogger(__name__)


@lru_cache
def _client() -> Any:
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )


def upload_pdf(data: bytes, key: str, content_type: str = "application/pdf") -> str:
    """Upload PDF bytes under `key` and return the s3:// storage path stored on the document row."""
    if not settings.s3_bucket:
        raise RuntimeError("S3_BUCKET is not set; cannot upload document.")
    _client().put_object(
        Bucket=settings.s3_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return f"s3://{settings.s3_bucket}/{key}"


def download_pdf(key: str) -> bytes:
    """Fetch object bytes for a storage key (accepts either a bare key or an s3:// path)."""
    if key.startswith("s3://"):
        key = key.split("/", 3)[3]
    resp = _client().get_object(Bucket=settings.s3_bucket, Key=key)
    return resp["Body"].read()
