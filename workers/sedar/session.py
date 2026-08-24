"""Playwright session for SEDAR+: persistent profile, challenge detection, headful takeover."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from playwright.sync_api import BrowserContext, Page, Playwright, sync_playwright

from common.config import settings

from .config import CHALLENGE_MARKERS
from .ratelimit import ChallengeDetected, RateLimiter

logger = logging.getLogger(__name__)

HEADFUL_SOLVE_SECONDS = 15 * 60
HEADFUL_POLL_SECONDS = 2.0


def profile_dir() -> Path:
    return Path(settings.sedar_profile_dir).expanduser()


def challenge_reason(page: Page, expected: str = "html") -> Optional[str]:
    """Return why the page looks challenged, or None if it looks like a real SEDAR+ page."""
    try:
        content = page.content()
    except Exception as exc:  # noqa: BLE001 - any failure to read the page is a stop
        return f"could not read page: {exc}"
    lowered = content.lower()
    if page.url and "denied" in page.url.lower():
        return f"denied url: {page.url}"
    if any(marker in lowered for marker in CHALLENGE_MARKERS):
        return "challenge marker in page body"
    if expected == "json":
        stripped = content.lstrip()
        if stripped and stripped[0] not in "{[":
            return "HTML body where JSON was expected"
    return None


def detect_challenge(page: Page, expected: str = "html") -> None:
    """Raise ChallengeDetected when Radware (or a 403 HTML wall) is in the way."""
    reason = challenge_reason(page, expected)
    if reason:
        raise ChallengeDetected(reason)


class SedarSession:
    def __init__(self, *, headful: Optional[bool] = None, limiter: Optional[RateLimiter] = None) -> None:
        self.headful = settings.sedar_headful if headful is None else headful
        self.limiter = limiter or RateLimiter()
        self._playwright: Optional[Playwright] = None
        self._context: Optional[BrowserContext] = None

    def start(self) -> BrowserContext:
        profile_dir().mkdir(parents=True, exist_ok=True)
        self._playwright = sync_playwright().start()
        self._context = self._playwright.chromium.launch_persistent_context(
            str(profile_dir()),
            headless=not self.headful,
            viewport={"width": 1280, "height": 800},
            locale="en-CA",
            timezone_id="America/Vancouver",
            args=["--disable-blink-features=AutomationControlled"],
        )
        return self._context

    def close(self) -> None:
        if self._context is not None:
            self._context.close()
            self._context = None
        if self._playwright is not None:
            self._playwright.stop()
            self._playwright = None

    def get_page(self) -> Page:
        if self._context is None:
            self.start()
        assert self._context is not None
        if self._context.pages:
            return self._context.pages[0]
        return self._context.new_page()

    def detect_challenge(self, page: Page, expected: str = "html") -> None:
        """In headful mode, wait for a manual solve instead of aborting immediately."""
        reason = challenge_reason(page, expected)
        if reason is None:
            return
        if self.headful:
            self._wait_for_solve(page, expected, reason)
            return
        self.limiter.record_challenge()
        raise ChallengeDetected(reason)

    def _wait_for_solve(self, page: Page, expected: str, reason: str) -> None:
        minutes = HEADFUL_SOLVE_SECONDS // 60
        logger.warning(
            "SEDAR+ challenged (%s). Solve it in the Chromium window; "
            "waiting up to %d minutes. Profile: %s",
            reason,
            minutes,
            profile_dir(),
        )
        deadline = time.monotonic() + HEADFUL_SOLVE_SECONDS
        while time.monotonic() < deadline:
            time.sleep(HEADFUL_POLL_SECONDS)
            if challenge_reason(page, expected) is None:
                logger.info("challenge cleared; solved cookies stay in %s", profile_dir())
                return
        self.limiter.record_challenge()
        raise ChallengeDetected(f"not solved within {HEADFUL_SOLVE_SECONDS}s: {reason}")

    def goto(self, url: str, *, expected: str = "html") -> Page:
        self.limiter.wait()
        page = self.get_page()
        response = page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        status = response.status if response is not None else None
        reason = challenge_reason(page, expected=expected)
        if reason is None and status in {401, 403, 429}:
            reason = f"HTTP {status} on {url}"
        if reason:
            if self.headful:
                self._wait_for_solve(page, expected, reason)
            else:
                self.limiter.record_challenge()
                raise ChallengeDetected(reason)
        return page


@contextmanager
def session(*, headful: Optional[bool] = None) -> Iterator[SedarSession]:
    managed = SedarSession(headful=headful)
    try:
        managed.start()
        yield managed
    finally:
        managed.close()
