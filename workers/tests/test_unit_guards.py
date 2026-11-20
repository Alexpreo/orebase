"""Self-check: unit and scale guards on extracted rows (short tons, $ vs $M, ounces as grade, NPV keys).

Run from workers/: `uv run python -m tests.test_unit_guards` (no DB or API needed).
"""

from common.extract_schemas import ProjectEconomics, ResourceEstimate

if __name__ == "__main__":
    short = ResourceEstimate(category="indicated", tonnes=89, tonnage_unit="short_Mt",
                             grade={"K2O_pct": 27}, extraction_confidence=0.9)
    assert round(short.tonnes) == 80_739_442 and short.extraction_confidence == 0.9

    ounces = ResourceEstimate(category="indicated", tonnes=12e6, tonnage_unit="t",
                              grade={"Au_gpt": 1_250_000, "Ag_gpt": 30}, extraction_confidence=0.9)
    assert ounces.grade == {"Ag_gpt": 30} and ounces.contained_metal == {"Au_oz": 1_250_000}
    assert ounces.extraction_confidence == 0.5
    kept = ResourceEstimate(category="indicated", tonnes=12e6, grade={"Au_gpt": 900},
                            contained_metal={"Au_oz": 5}, extraction_confidence=0.9)
    assert kept.grade == {"Au_gpt": 900} and kept.contained_metal == {"Au_oz": 5}

    dollars = ProjectEconomics(npv={"post_tax_8pct": 235_000_000}, capex_initial=3_628_000_000,
                               extraction_confidence=0.9)
    assert dollars.npv == {"post_tax_8pct": 235.0} and dollars.capex_initial == 3628.0
    assert dollars.extraction_confidence == 0.6
    thousands = ProjectEconomics(capex_initial=325_400, extraction_confidence=0.9)
    assert thousands.capex_initial == 325_400 and thousands.extraction_confidence == 0.3
    millions = ProjectEconomics(npv={"post_tax_5pct": 1039, "post_tax_14.67pct": 800},
                                capex_initial=579, extraction_confidence=0.9)
    assert millions.npv == {"post_tax_5pct": 1039, "post_tax_14.67pct": 800}
    assert millions.extraction_confidence == 0.9

    unspecified = ProjectEconomics(npv={"unspecified": 71_674, "post_tax_5pct": 41}, extraction_confidence=0.9)
    assert unspecified.npv == {"post_tax_5pct": 41} and unspecified.extraction_confidence == 0.4
    print("unit guards: all checks passed")
