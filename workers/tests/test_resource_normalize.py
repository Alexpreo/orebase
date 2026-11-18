"""Self-check: category/domain split and tonnage-unit conversion on resource rows.

Run from workers/: `uv run python -m tests.test_resource_normalize` (no DB or API needed).
"""

from common.extract_schemas import ResourceEstimate, split_category

CASES = {
    "indicated - total (exclusive of reserves)": ("indicated", "exclusive of reserves"),
    "measured + indicated resource (inclusive of reserves) - total": ("measured+indicated", "inclusive of reserves"),
    "inferred - upper silver zone": ("inferred", "upper silver zone"),
    "proved mineral reserve - driefontein 5 tsf": ("proven", "driefontein 5 tsf"),
    "underground p&p reserve": ("2p", "underground"),
    "M&I": ("measured+indicated", None),
    "Inferred": ("inferred", None),
    "total indicated+inferred": ("total indicated+inferred", None),  # not a standard class
    "historic estimate (oxide zone)": ("historic estimate (oxide zone)", None),
}

if __name__ == "__main__":
    for label, want in CASES.items():
        assert split_category(label) == want, (label, split_category(label))

    mt = ResourceEstimate(category="Indicated - total", tonnes=417.346, tonnage_unit="Mt",
                          grade={"Cu_pct": 0.41}, extraction_confidence=0.9)
    assert (mt.category, mt.domain, round(mt.tonnes), mt.extraction_confidence) == ("indicated", None, 417_346_000, 0.9)
    kt = ResourceEstimate(category="inferred", tonnes=1200, tonnage_unit="kt", grade={}, extraction_confidence=0.9)
    assert kt.tonnes == 1_200_000
    unconverted = ResourceEstimate(category="inferred", tonnes=25.0, grade={}, extraction_confidence=0.9)
    assert unconverted.extraction_confidence == 0.5, "implausibly small tonnage must be flagged"
    odd = ResourceEstimate(category="historic estimate", tonnes=5e6, grade={}, extraction_confidence=0.9)
    assert odd.extraction_confidence == 0.3, "non-standard class keeps the cap"
    print("resource normalize: all checks passed")
