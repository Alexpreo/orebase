"""Drain extract jobs: triage every indexed filing, then structured extraction
for technical reports.

Claiming uses the same FOR UPDATE SKIP LOCKED primitive as the processor. Dollar
caps are checked before a claim so a retry loop cannot burn the month.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import time
from typing import Any, Optional

from pydantic import ValidationError

from common.claude import ClaudeUnavailable, complete_tool, estimate_cost_usd
from common.config import settings
from common.db import (
    ExtractionCapExceeded,
    assert_extraction_cap,
    claim_job,
    complete_job,
    connection,
    enqueue_extract_for_indexed,
    get_document,
    get_document_chunks,
    list_pending_jobs,
    set_document_status,
)
from common.extract_schemas import (
    DRILL_TOOL,
    ECONOMICS_TOOL,
    EXTRACT_SYSTEM,
    QP_TOOL,
    RESOURCE_TOOL,
    TECHNICAL_DOC_TYPES,
    TRIAGE_SYSTEM,
    TRIAGE_TOOL,
    DrillResult,
    ProjectEconomics,
    QualifiedPerson,
    ResourceEstimate,
    TriageResult,
)
from common.extract_store import (
    clear_document_facts,
    insert_drills,
    insert_economics,
    insert_project_event,
    insert_qps,
    insert_resources,
)
from common.html_tables import extract_from_html
from common.resolve import parse_cik, parse_title_company, resolve_document
from common.s3 import download_object

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("extractor")

MAX_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 2.0
SECTION_CHAR_BUDGET = 80_000
NEAR_DUPE_JACCARD = 0.6
TRIAGE_PAGE_LIMIT = 2
MAX_DRILL_ROWS = 40

RESOURCE_HINTS = (
    "mineral resource",
    "resource estimate",
    "item 14",
    "mineral reserve",
    "reserve estimate",
    "resource classification",
)
ECONOMICS_HINTS = (
    "economic analysis",
    "capital and operating",
    "item 21",
    "item 22",
    "after-tax npv",
    "pre-tax npv",
    "internal rate of return",
    "all-in sustaining",
)
DRILL_HINTS = ("drilling", "drill hole", "intercept", "assay result")
QP_HINTS = ("qualified person", "item 2", "certificate of qualified")


def _fallback_triage(doc: dict[str, Any]) -> TriageResult:
    name, ticker, cik = parse_title_company(doc.get("title"))
    return TriageResult(
        company_name=name or "Unknown company",
        cik=cik or parse_cik(doc),
        ticker=ticker,
        project_name=None,
        summary=(doc.get("title") or "Filing")[:240],
    )


def _format_chunks(chunks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for chunk in chunks:
        page_start = chunk.get("page_start") or "?"
        page_end = chunk.get("page_end") or page_start
        section = chunk.get("section_title") or ""
        header = f"[p.{page_start}-{page_end} | {section}]"
        parts.append(f"{header}\n{chunk.get('content') or ''}")
    return "\n\n".join(parts)


def _select_chunks(
    chunks: list[dict[str, Any]], hints: tuple[str, ...], budget: int = SECTION_CHAR_BUDGET
) -> list[dict[str, Any]]:
    def matches(chunk: dict[str, Any], use_full: bool) -> bool:
        title = (chunk.get("section_title") or "").lower()
        content = (chunk.get("content") or "").lower()
        hay = f"{title} {content if use_full else content[:500]}"
        return any(hint in hay for hint in hints)

    selected = [c for c in chunks if matches(c, False)]
    if not selected:
        selected = [c for c in chunks if matches(c, True)]
    packed: list[dict[str, Any]] = []
    used = 0
    for chunk in selected:
        size = len(chunk.get("content") or "")
        if packed and used + size > budget:
            break
        packed.append(chunk)
        used += size
    return packed


def _first_pages(chunks: list[dict[str, Any]], pages: int) -> list[dict[str, Any]]:
    return [c for c in chunks if (c.get("page_end") or 1) <= pages] or chunks[:3]


def _parse_rows(model_cls, payload: dict[str, Any]) -> list:
    if payload.get("_dry_run"):
        return []
    rows = payload.get("rows") or []
    parsed = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        try:
            parsed.append(model_cls.model_validate(raw))
        except ValidationError:
            try:
                # Keep salvageable rows at low confidence rather than dropping them.
                salvage = dict(raw)
                salvage["extraction_confidence"] = 0.3
                parsed.append(model_cls.model_validate(salvage))
            except ValidationError:
                logger.warning("dropped unparseable extraction row: %s", list(raw)[:8])
    return parsed


def _chunk_fingerprint(chunks: list[dict[str, Any]]) -> set[str]:
    fingerprints: set[str] = set()
    for chunk in chunks:
        text = (chunk.get("content") or "")[:500]
        if text:
            fingerprints.add(hashlib.sha256(text.encode("utf-8")).hexdigest())
    return fingerprints


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _is_near_duplicate(document_id: str, project_id: str, chunks: list[dict[str, Any]]) -> bool:
    mine = _chunk_fingerprint(chunks)
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id
              FROM raw.documents d
             WHERE d.project_id = %s
               AND d.id <> %s
               AND (
                    EXISTS (
                        SELECT 1 FROM core.resource_estimates r
                         WHERE r.document_id = d.id
                    )
                    OR EXISTS (
                        SELECT 1 FROM core.project_economics e
                         WHERE e.document_id = d.id
                    )
               );
            """,
            (project_id, document_id),
        )
        others = [str(row["id"]) for row in cur.fetchall()]
    for other_id in others:
        other_chunks = get_document_chunks(other_id)
        if _jaccard(mine, _chunk_fingerprint(other_chunks)) >= NEAR_DUPE_JACCARD:
            logger.info(
                "document %s is a near-duplicate of %s; skipping full extract",
                document_id, other_id,
            )
            return True
    return False


def _call_rows(
    *,
    model: str,
    purpose: str,
    tool: dict[str, Any],
    chunks: list[dict[str, Any]],
    model_cls,
    document_id: str,
    dry_run: bool,
    extra_user: str = "",
) -> list:
    if not chunks and not extra_user:
        return []
    user = extra_user
    if chunks:
        user = (user + "\n\n" if user else "") + _format_chunks(chunks)
    try:
        payload = complete_tool(
            model=model,
            system=EXTRACT_SYSTEM if purpose != "triage" else TRIAGE_SYSTEM,
            user=user,
            tools=[tool],
            tool_choice=tool["name"],
            purpose=purpose,
            document_id=document_id,
            dry_run=dry_run,
        )
    except ClaudeUnavailable as exc:
        logger.warning("Claude unavailable for %s on %s: %s", purpose, document_id, exc)
        return []
    return _parse_rows(model_cls, payload)


def triage_document(
    doc: dict[str, Any], chunks: list[dict[str, Any]], dry_run: bool
) -> tuple[TriageResult, bool]:
    intro = (
        f"Title: {doc.get('title')}\n"
        f"Doc type: {doc.get('doc_type')}\n"
        f"Filed: {doc.get('filed_at')}\n\n"
        "First pages of the filing:\n"
    )
    try:
        payload = complete_tool(
            model=settings.extract_haiku_model,
            system=TRIAGE_SYSTEM,
            user=intro + _format_chunks(_first_pages(chunks, TRIAGE_PAGE_LIMIT)),
            tools=[TRIAGE_TOOL],
            tool_choice=TRIAGE_TOOL["name"],
            purpose="triage",
            document_id=str(doc["id"]),
            dry_run=dry_run,
        )
    except ClaudeUnavailable as exc:
        logger.warning("triage API failed for %s: %s; using title fallback", doc["id"], exc)
        return _fallback_triage(doc), False
    if payload.get("_dry_run"):
        return _fallback_triage(doc), True
    try:
        return TriageResult.model_validate(payload), True
    except ValidationError:
        logger.warning("triage validation failed for %s; using title fallback", doc["id"])
        return _fallback_triage(doc), True


def process_document(document_id: str, dry_run: bool = False) -> dict[str, Any]:
    doc = get_document(document_id)
    if doc is None:
        raise RuntimeError(f"document {document_id} not found")
    chunks = get_document_chunks(document_id)
    stats: dict[str, Any] = {
        "resources": 0,
        "economics": 0,
        "drills": 0,
        "qps": 0,
        "skipped_dupe": False,
        "full_extract": False,
    }

    triage, claude_ok = triage_document(doc, chunks, dry_run)
    if dry_run:
        resource_chunks = _select_chunks(chunks, RESOURCE_HINTS)
        econ_chunks = _select_chunks(chunks, ECONOMICS_HINTS)
        est = (
            estimate_cost_usd(settings.extract_haiku_model, max(1, 2000))
            + estimate_cost_usd(
                settings.extract_sonnet_model,
                max(1, (len(_format_chunks(resource_chunks)) + len(_format_chunks(econ_chunks))) // 4),
            )
        )
        stats["dry_run_est_usd"] = str(est)
        if settings.debug:
            logger.info(
                "[DEBUG] extractor.dry_run doc=%s title=%s resource_chunks=%d econ_chunks=%d est_usd=%s",
                document_id, doc.get("title"), len(resource_chunks), len(econ_chunks), est,
            )
        return stats

    company_id, project_id = resolve_document(doc, triage)
    event_date = doc.get("filed_at")
    if project_id:
        insert_project_event(
            project_id,
            document_id,
            "new_report",
            event_date,
            triage.summary,
        )

    doc_type = (doc.get("doc_type") or triage.doc_type or "").lower()
    if doc_type not in TECHNICAL_DOC_TYPES:
        set_document_status(document_id, "extracted")
        stats["reason"] = "not_technical_report"
        return stats

    if not project_id:
        logger.warning("document %s has no resolved project; skipping fact extract", document_id)
        set_document_status(document_id, "extracted")
        stats["reason"] = "unresolved_project"
        return stats

    if _is_near_duplicate(document_id, project_id, chunks):
        set_document_status(document_id, "extracted")
        stats["skipped_dupe"] = True
        return stats

    html_resources: list[ResourceEstimate] = []
    html_economics: list[ProjectEconomics] = []
    source_path = doc.get("source_storage_path")
    source_type = (doc.get("source_content_type") or "").lower()
    if source_path and "html" in source_type:
        try:
            html_resources, html_economics = extract_from_html(download_object(source_path))
        except Exception as exc:  # noqa: BLE001 - HTML parse must not fail the job
            logger.warning("HTML table parse failed for %s: %s", document_id, exc)

    resources = list(html_resources)
    economics = list(html_economics)
    if not resources and claude_ok:
        resources = _call_rows(
            model=settings.extract_sonnet_model,
            purpose="extract",
            tool=RESOURCE_TOOL,
            chunks=_select_chunks(chunks, RESOURCE_HINTS) or chunks[:12],
            model_cls=ResourceEstimate,
            document_id=document_id,
            dry_run=False,
        )
    if not economics and claude_ok:
        econ_chunks = _select_chunks(chunks, ECONOMICS_HINTS)
        if econ_chunks:
            economics = _call_rows(
                model=settings.extract_sonnet_model,
                purpose="extract",
                tool=ECONOMICS_TOOL,
                chunks=econ_chunks,
                model_cls=ProjectEconomics,
                document_id=document_id,
                dry_run=False,
            )
    drill_chunks = _select_chunks(chunks, DRILL_HINTS)
    drills: list[DrillResult] = []
    if claude_ok and drill_chunks:
        drills = _call_rows(
            model=settings.extract_haiku_model,
            purpose="extract",
            tool=DRILL_TOOL,
            chunks=drill_chunks,
            model_cls=DrillResult,
            document_id=document_id,
            dry_run=False,
        )[:MAX_DRILL_ROWS]
    qp_chunks = _select_chunks(chunks, QP_HINTS)
    qps: list[QualifiedPerson] = []
    if claude_ok and qp_chunks:
        qps = _call_rows(
            model=settings.extract_haiku_model,
            purpose="extract",
            tool=QP_TOOL,
            chunks=qp_chunks,
            model_cls=QualifiedPerson,
            document_id=document_id,
            dry_run=False,
        )

    clear_document_facts(document_id)
    # Re-insert the triage event after the fact wipe.
    insert_project_event(project_id, document_id, "new_report", event_date, triage.summary)
    stats["resources"] = insert_resources(project_id, document_id, resources)
    stats["economics"] = insert_economics(project_id, document_id, economics)
    stats["drills"] = insert_drills(project_id, document_id, drills)
    stats["qps"] = insert_qps(document_id, qps)
    if stats["resources"]:
        insert_project_event(
            project_id, document_id, "resource_update", event_date, triage.summary
        )
    set_document_status(document_id, "extracted")
    stats["full_extract"] = True
    stats["company_id"] = company_id
    stats["project_id"] = project_id
    if settings.debug:
        logger.info("[DEBUG] extractor.done doc=%s stats=%s", document_id, stats)
    return stats


def _handle_job(job: dict[str, Any], dry_run: bool) -> None:
    job_id = job["id"]
    document_id = str(job["document_id"])
    try:
        if not dry_run:
            assert_extraction_cap()
        stats = process_document(document_id, dry_run=dry_run)
        if not dry_run:
            complete_job(job_id, status="done")
        logger.info("extract job %s doc=%s stats=%s", job_id, document_id, stats)
    except ExtractionCapExceeded:
        raise
    except Exception as exc:  # noqa: BLE001
        attempts = int(job.get("attempts", 0))
        if attempts >= MAX_ATTEMPTS:
            complete_job(job_id, status="failed", last_error=str(exc)[:2000])
            logger.error("extract job %s permanently failed: %s", job_id, exc)
        else:
            complete_job(job_id, status="pending", last_error=str(exc)[:2000])
            backoff = BACKOFF_BASE_SECONDS * (2 ** (attempts - 1))
            logger.warning(
                "extract job %s failed (attempt %d), re-queued; backing off %.1fs: %s",
                job_id, attempts, backoff, exc,
            )
            time.sleep(backoff)


def run(
    *,
    once: bool,
    dry_run: bool,
    document_id: Optional[str],
    backfill: bool,
    idle_sleep: float,
) -> None:
    if backfill:
        n = enqueue_extract_for_indexed()
        logger.info("backfilled %d extract jobs", n)
    if document_id:
        if not dry_run:
            assert_extraction_cap()
        stats = process_document(document_id, dry_run=dry_run)
        logger.info("extract document %s stats=%s", document_id, stats)
        return
    if dry_run:
        jobs = list_pending_jobs("extract")
        logger.info("dry-run over %d pending extract jobs", len(jobs))
        for job in jobs:
            stats = process_document(str(job["document_id"]), dry_run=True)
            logger.info("dry-run doc=%s stats=%s", job["document_id"], stats)
            if once:
                break
        return
    logger.info("extractor started (once=%s)", once)
    while True:
        try:
            assert_extraction_cap()
        except ExtractionCapExceeded as exc:
            logger.error("%s; extractor sleeping", exc)
            if once:
                break
            time.sleep(max(idle_sleep, 60.0))
            continue
        job = claim_job("extract")
        if job is None:
            if once:
                break
            time.sleep(idle_sleep)
            continue
        _handle_job(job, dry_run=False)
        if once:
            break


def main() -> None:
    parser = argparse.ArgumentParser(description="Drain OreBase extract jobs.")
    parser.add_argument("--once", action="store_true", help="process a single job then exit")
    parser.add_argument("--dry-run", action="store_true", help="estimate token cost; no writes")
    parser.add_argument("--document-id", help="process one document id without claiming a job")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="enqueue extract jobs only for indexed documents that have never been extracted",
    )
    parser.add_argument("--idle-sleep", type=float, default=5.0)
    args = parser.parse_args()
    run(
        once=args.once,
        dry_run=args.dry_run,
        document_id=args.document_id,
        backfill=args.backfill,
        idle_sleep=args.idle_sleep,
    )


if __name__ == "__main__":
    main()
