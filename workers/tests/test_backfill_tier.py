"""Self-check: old filings route to the cheap backfill tier; only a project's latest report
gets full extraction. Run from workers/: `uv run python -m tests.test_backfill_tier` (no DB/API)."""

from datetime import date, timedelta

import extractor
from common.config import settings

old = {"id": "d-old", "filed_at": date.today() - timedelta(days=365 * 3)}
new = {"id": "d-new", "filed_at": date.today() - timedelta(days=30)}
undated = {"id": "d-x", "filed_at": None}

if __name__ == "__main__":
    extractor.document_on_watchlist = lambda _id: False

    m = extractor._models_for(old, use_batch=False)
    assert (m.backfill, m.light, m.numeric, m.escalation, m.batch) == (
        True, settings.backfill_model, settings.backfill_numeric_model,
        settings.backfill_numeric_model, True)
    m = extractor._models_for(new, use_batch=False)
    assert (m.backfill, m.light, m.escalation, m.batch) == (
        False, settings.extract_model, settings.extract_escalation_model, False)
    assert extractor._models_for(undated, use_batch=False).backfill is False

    extractor.newer_technical_report_exists = lambda *_a: True
    assert extractor.should_full_extract(old, force=False, project_id="p") is False  # superseded
    assert extractor.should_full_extract(new, force=False, project_id="p") is True   # live always
    assert extractor.should_full_extract(undated, force=False, project_id="p") is True
    assert extractor.should_full_extract(old, force=True, project_id="p") is True
    extractor.newer_technical_report_exists = lambda *_a: False
    assert extractor.should_full_extract(old, force=False, project_id="p") is True   # latest

    # Escalating to the same model would just pay twice: it must stop after one call.
    calls = []
    extractor._call_rows = lambda **k: calls.append(k["model"]) or [
        type("R", (), {"extraction_confidence": 0.3})()]
    extractor._call_rows_escalating(model="m", escalation_model="m", tool={}, chunks=[1],
                                    model_cls=None, document_id="d", use_batch=True)
    assert calls == ["m"], calls
    print("backfill tier: all checks passed")
