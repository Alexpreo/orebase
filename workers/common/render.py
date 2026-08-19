"""Render HTML filings to PDF so every document has one citable, page-anchored artifact.

EDGAR files SK-1300 technical report summaries as HTML exhibits. Chunk citations point at
a page number, so HTML gets rendered once to PDF and that PDF becomes the display artifact.

The render settings below are a pinned contract, not preferences. Page numbers derived from
a render are only meaningful against that exact output: change the paper size, margins, or
scale and every previously stored page anchor silently points at the wrong content. Render
each document once, store it, and never re-render. If these constants ever must change,
treat it as a corpus-wide re-chunk, not a config tweak.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# Identifies the exact render a stored page anchor belongs to. Bumped from
# `letter-0.5in-scale1`, whose margins overflowed every page-broken block onto an empty
# second page and whose figures were dropped by SEC rate limiting.
RENDER_ENGINE = "playwright-chromium/letter-0.4in-scale1"

_PAPER_FORMAT = "Letter"
# 0.5in leaves a printable area marginally shorter than the blocks filers lay out ahead of
# a `page-break-before`, so each block spilled its last fraction of an inch onto a blank
# page -- one filing rendered 170 pages of which 84 were empty. 0.4in clears the overflow;
# anything smaller changes nothing further.
_MARGIN = "0.4in"
_SCALE = 1.0
# Assets are fetched one at a time to respect SEC's rate limit, so a figure-heavy report
# needs well beyond the few seconds an unthrottled load would take.
_LOAD_TIMEOUT_MS = 120_000

# (body, content_type) for a fetched asset, or None when it could not be retrieved.
AssetFetcher = Callable[[str], Optional[tuple[bytes, str]]]


def html_to_pdf(
    html: bytes,
    base_url: str | None = None,
    user_agent: str | None = None,
    fetch_asset: AssetFetcher | None = None,
) -> bytes:
    """Render HTML bytes to PDF using headless Chromium.

    `base_url` lets relative asset paths resolve against the original filing location.

    `fetch_asset` retrieves images and stylesheets on the page's behalf. Chromium requests
    every figure in parallel, which trips SEC rate limiting and returns 403 for most of
    them -- a filing referencing 38 figures rendered exactly one, leaving 36 pages blank
    with no error raised. Routing assets through a throttled fetcher keeps them within the
    request ceiling. Without one, the page fetches its own assets and figures may be lost.
    """
    from playwright.sync_api import sync_playwright

    text = html.decode("utf-8", errors="replace")

    def handle(route, request) -> None:
        url = request.url
        if url == base_url:
            route.fulfill(body=text, content_type="text/html")
            return
        if fetch_asset is None:
            route.continue_()
            return
        try:
            asset = fetch_asset(url)
        except Exception as exc:  # noqa: BLE001 - one bad asset must not fail the render
            logger.warning("asset fetch raised for %s: %s", url, exc)
            asset = None
        if asset is None:
            # Abort rather than continue: an unthrottled retry by the browser is what
            # gets rate-limited in the first place.
            route.abort()
            return
        body, content_type = asset
        route.fulfill(body=body, content_type=content_type)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
        try:
            context = browser.new_context(
                **({"user_agent": user_agent} if user_agent else {})
            )
            page = context.new_page()
            if base_url:
                # Serving the document at its original URL keeps relative <img>/<link>
                # references resolvable instead of silently dropping figures.
                page.route("**/*", handle)
                page.goto(base_url, wait_until="load", timeout=_LOAD_TIMEOUT_MS)
            else:
                page.set_content(text, wait_until="load", timeout=_LOAD_TIMEOUT_MS)

            return page.pdf(
                format=_PAPER_FORMAT,
                scale=_SCALE,
                print_background=True,
                margin={
                    "top": _MARGIN,
                    "bottom": _MARGIN,
                    "left": _MARGIN,
                    "right": _MARGIN,
                },
            )
        finally:
            browser.close()
