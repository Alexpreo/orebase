"""Self-check: a Claude outage or an empty re-run must never strip a document's facts.

Run from workers/: `uv run python -m tests.test_extract_safety` (no DB or API needed).
"""

from __future__ import annotations

from datetime import date

import extractor
from common import extract_store
from common.claude import ClaudeUnavailable
from common.extract_schemas import TriageResult


def _patch_document(calls: list) -> None:
    doc = {"id": "doc-1", "title": "Test NI 43-101", "doc_type": "ni43101", "filed_at": date.today()}
    chunks = [{"content": "Item 14 Mineral Resource Estimates ...", "section_title": "Item 14",
               "page_start": 1, "page_end": 1}]
    extractor.get_document = lambda _id: doc
    extractor.get_document_chunks = lambda _id: chunks
    extractor.resolve_document = lambda _doc, _triage: ("co-1", "proj-1")
    extractor.should_full_extract = lambda _doc, force, **_k: True
    extractor._is_near_duplicate = lambda *_a: False
    extractor.insert_project_event = lambda *a, **k: calls.append(("event", a))
    extractor.set_document_status = lambda _id, status, **k: calls.append(("status", status))
    extractor.replace_document_facts = lambda *a, **k: calls.append(("replace", k)) or {}


def test_outage_during_triage_does_not_mark_extracted() -> None:
    calls: list = []
    _patch_document(calls)

    def boom(**_kwargs):
        raise ClaudeUnavailable("billing outage")

    extractor.complete_tool = boom
    try:
        extractor.process_document("doc-1")
    except ClaudeUnavailable:
        pass
    else:
        raise AssertionError("outage must propagate so the job retries")
    assert ("status", "extracted") not in calls, calls
    assert not any(c[0] == "replace" for c in calls), calls


def test_outage_during_fact_call_does_not_mark_extracted() -> None:
    calls: list = []
    _patch_document(calls)
    triage = TriageResult(company_name="Co", summary="s").model_dump()

    def triage_then_boom(**kwargs):
        if kwargs["purpose"] == "triage":
            return triage
        raise ClaudeUnavailable("overloaded")

    extractor.complete_tool = triage_then_boom
    try:
        extractor.process_document("doc-1")
    except ClaudeUnavailable:
        pass
    else:
        raise AssertionError("outage during fact extraction must propagate")
    assert ("status", "extracted") not in calls, calls
    assert not any(c[0] == "replace" for c in calls), calls


def test_empty_replace_never_touches_db() -> None:
    def no_db():
        raise AssertionError("empty extraction must not open a connection")

    extract_store.connection = no_db
    assert extract_store.replace_document_facts(
        "proj-1", "doc-1", resources=[], economics=[], drills=[], qps=[]
    ) is None


if __name__ == "__main__":
    test_outage_during_triage_does_not_mark_extracted()
    test_outage_during_fact_call_does_not_mark_extracted()
    test_empty_replace_never_touches_db()
    print("extract safety: 3 checks passed")
