"""Self-check: the --ni43101 path keeps a 6-K EX-99 report from a non-mining SIC, which the
default path drops. Run from workers/: `uv run python -m tests.test_edgar_ni43101` (no DB/API)."""
import edgar_poller as ep

if __name__ == "__main__":
    ep.document_exists_by_external_id = lambda *_a: True  # stop right after the gates
    hit = ep.FilingHit(accession="0000000000-23-000001", filename="tm235701d11_ex99-2.htm",
                       cik="1", form="6-K", file_type="EX-99.2", title="Electra",
                       filed_at="2023-03-01", sic=3690)
    ni = ep.parse_file_types(ep.NI43101_FILE_TYPES)
    assert ep.process_hit(None, hit, 1000, 1099, ni, "ni43101") == "skipped_known"
    assert ep.process_hit(None, hit, 1000, 1099, ni) == "skipped_sic"
    assert ep.process_hit(None, hit, 1000, 1099, ep.parse_file_types(None), "ni43101") == "skipped_file_type"
    print("ok")
