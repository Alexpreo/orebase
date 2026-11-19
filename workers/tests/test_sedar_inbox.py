"""Self-check: SEDAR+ zip PDFs match CSV rows by profile number + document + size, and
anything ambiguous stays unmatched. Run from workers/: `uv run python -m tests.test_sedar_inbox`."""
from dataclasses import replace
from pathlib import Path

from sedar.ingest_local import _export_row, load_index, match_row, parse_member

def _write_export(r):
    import tempfile
    f = Path(tempfile.mkdtemp()) / "export.csv"
    f.write_text("Search\n\nProfile(s),Document,Submitted date,Principal jurisdiction,File size\n"
                 f'"{r.profile_name} (000004216)",{r.document},Sun Oct 04 {r.submitted_time_et} EDT 2026,'
                 f"{r.jurisdiction},{r.file_size_kb} KB\n")
    return f


MANIFESTS = sorted((Path(__file__).resolve().parents[2] / "sedar_manifests").glob("sedar_2026Q4*.csv"))

if __name__ == "__main__":
    full = load_index([m for m in MANIFESTS if m.stem == "sedar_2026Q4"])
    both = load_index(MANIFESTS)
    assert len(full) == len(both) > 90, (len(full), len(both))  # p1-p4 are pages of the full file

    member = ("000052522 Fairplay Ventures Inc. / Fairplay Ventures Inc. /06515195 TECHNICAL_REPORT/1/"
              "Technical report (NI 43-101) - English.pdf (bd1f062dd1720b50)")
    pnum, folder, filing, doc = parse_member(member)
    assert (pnum, folder, filing, doc) == (
        "000052522", "Fairplay Ventures Inc.", "06515195", "Technical report (NI 43-101) - English.pdf")
    row = match_row(pnum, folder, doc, 23035285, both)
    assert row and str(row.submitted_date) == "2026-11-17", row
    assert match_row(pnum, folder, doc, 5_000_000, both) is None  # same name, other filing: no guess

    # Same issuer + document twice: size breaks the tie; equal sizes stay unmatched.
    other = replace(row, submitted_date=row.submitted_date.replace(day=1), file_size_kb=4000)
    assert match_row(pnum, folder, doc, 23035285, [row, other]) == row
    assert match_row(pnum, folder, doc, 4000 * 1024, [row, other]) == other
    assert match_row(pnum, folder, doc, 23035285, [row, replace(other, file_size_kb=row.file_size_kb)]) is None

    # A renamed issuer lists one filing under two names: same date/time/size is one match.
    renamed = replace(row, profile_name="Old Name Corp.")
    assert match_row(pnum, folder, doc, 23035285, [renamed, row]) == row

    # No profile number in the CSV: match on company name, ignoring "(formerly ...)".
    omai = next(r for r in both if r.profile_name.startswith("Omai"))
    assert match_row("000099999", "Omai Gold Mines Corp.", omai.document, omai.file_size_kb * 1024, both) == omai

    # The same filing from an export (with profile number) and a manifest (without) is one row.
    merged = load_index(MANIFESTS + [_write_export(omai)])
    assert len(merged) == len(both) and any(r.profile_name == omai.profile_name and r.profile_number for r in merged)

    exported = _export_row(["Fairplay Ventures Inc. / Fairplay Ventures Inc. (000052522)",
                            "Technical report (NI 43-101) - English.pdf",
                            "Tue Nov 17 15:35:18 EST 2026", "Ontario", "22495 KB"])
    assert exported == row, (exported, row)
    print("sedar inbox: all checks passed")
