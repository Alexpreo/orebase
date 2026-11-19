"""Clear the review queue by checking each row's figures against its own source text.

A row is 'auto_source_match' only when its key figures appear together in one chunk of its
document (a resource row's tonnes and grade in the same table; a drill row's hole id and
interval; an economics row's NPV with its IRR or capex). Short numbers ("4.8") prove
nothing on their own, so a figure needs 3+ significant digits to count alone.

    uv run python -m scripts.verify_review                 # dry run: counts + rows to read
    uv run python -m scripts.verify_review --apply --out /tmp/to_read.json
"""

from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

from common.db import connection


def _forms(x, scales=(1.0,)) -> set[str]:
    out: set[str] = set()
    if x is None:
        return out
    for s in scales:
        v = float(x) * s
        if v <= 0:
            continue
        for d in (0, 1, 2, 3):
            if d == 0 and abs(v - round(v)) > 1e-9:
                continue
            t = f"{v:,.{d}f}"
            out |= {t, t.replace(",", ""), t.replace(",", " ")}
    return out


def _digits(form: str) -> int:
    return len(re.sub(r"\D", "", form).lstrip("0"))


def _hit(text: str, x, scales=(1.0,), min_digits: int = 1) -> bool:
    return any(
        _digits(f) >= min_digits and re.search(r"(?<![\d.,])" + re.escape(f) + r"(?![\d]|[.,]\d)", text)
        for f in _forms(x, scales)
    )


def _norm_id(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


TONNE_SCALES = (1.0, 1e-3, 1e-6)
MONEY_SCALES = (1.0, 1e-3, 1e-6)


NEAR = 160  # characters: one table row, give or take a wrapped cell
TOC_LINE = re.compile(r"(\.{4,}|(\. ){4,})\s*\d{1,4}")
OZ_PER_G = 1 / 31.1035
GRADE_MAX = {"gpt": 60.0, "pct": 70.0, "ppm": 300_000.0}  # beyond these a "grade" is another column
SILVER_GPT_MAX = 5000.0


def _positions(text: str, x, scales=(1.0,), min_digits: int = 1) -> list[int]:
    return [
        m.start()
        for f in _forms(x, scales)
        if _digits(f) >= min_digits
        for m in re.finditer(r"(?<![\d.,])" + re.escape(f) + r"(?![\d]|[.,]\d)", text)
    ]


def _grade_plausible(key: str, value: float) -> bool:
    metal, _, unit = key.partition("_")
    if metal == "Ag" and unit == "gpt":
        return value <= SILVER_GPT_MAX
    return value <= GRADE_MAX.get(unit, float("inf"))


def _contained_consistent(r) -> bool:
    """Where contained metal is stored, tonnes x grade must reproduce it (3% for rounding)."""
    tonnes = float(r["tonnes"] or 0)
    grades = r["grade"] or {}
    for key, contained in (r["contained_metal"] or {}).items():
        if not isinstance(contained, (int, float)) or contained <= 0:
            continue
        metal, _, unit = key.partition("_")
        if f"{metal}_gpt" in grades and unit in ("oz", "koz", "Moz"):
            expect = tonnes * grades[f"{metal}_gpt"] * OZ_PER_G
        elif f"{metal}_pct" in grades and unit in ("lb", "klb", "Mlb", "t", "kt", "Mt"):
            expect = tonnes * grades[f"{metal}_pct"] / 100 * (2204.62 if "lb" in unit else 1.0)
        else:
            continue  # units this check can't relate (equivalents, ppm, oxides)
        scale = {"k": 1e3, "M": 1e6}.get(unit[0], 1.0) if unit not in ("t",) else 1.0
        if abs(contained * scale - expect) > 0.03 * max(expect, 1.0):
            return False
    return True


CATEGORY_WORDS = {
    "measured": r"measured", "indicated": r"indicated", "inferred": r"inferred",
    "proven": r"prove[nd]", "probable": r"probable",
    "measured+indicated": r"m\s*(\+|&|and)\s*i\b|measured\s*(\+|&|and)\s*indicated",
    "2p": r"\b2p\b|proven\s*(\+|&|and)\s*probable|p\s*&\s*p|total\s+(mineral\s+)?reserves?",
}


def _category_near(text: str, pos: int, category: str) -> bool:
    pattern = CATEGORY_WORDS.get((category or "").lower())
    return bool(pattern) and re.search(pattern, text[max(0, pos - 250) : pos + 40], re.I) is not None


def check_resource(r, chunks) -> bool:
    grades = {k: v for k, v in (r["grade"] or {}).items() if isinstance(v, (int, float))}
    if not all(_grade_plausible(k, v) for k, v in grades.items()) or not _contained_consistent(r):
        return False
    for c in chunks:
        lines = c.splitlines() or [c]
        if sum(bool(TOC_LINE.search(l)) for l in lines) > len(lines) / 3:
            continue
        for t in _positions(c, r["tonnes"], TONNE_SCALES, min_digits=3):
            if not _category_near(c, t, r["category"]):
                continue
            window = c[t : t + NEAR]
            if grades and all(_positions(window, g) for g in grades.values()):
                return True
            if not grades and _digits(window[:12]) >= 3:
                return True
    return False


def check_drill(r, chunks) -> bool:
    hole = _norm_id(r["hole_id"] or "")
    if len(hole) < 3:
        return False
    for c in chunks:
        for m in re.finditer(re.escape(r["hole_id"]), c, re.I):
            w = c[m.end() : m.end() + NEAR]
            assays = [v for v in (r["assays"] or {}).values() if isinstance(v, (int, float))]
            if (
                _positions(w, r["interval_m"], min_digits=2)
                and (r["from_m"] is None or _positions(w, r["from_m"]))
                and (not assays or any(_positions(w, a) for a in assays))
            ):
                return True
    return False


def _is_toc(chunk: str) -> bool:
    lines = chunk.splitlines() or [chunk]
    return sum(bool(TOC_LINE.search(l)) for l in lines) > len(lines) / 3


def check_econ(r, chunks) -> bool:
    """NPV printed exactly as stored (same unit), labelled NPV just before it, and the row's
    IRR or capex nearby when stored. Single unlabelled figures go to a reader."""
    npvs = [v for v in (r["npv"] or {}).values() if isinstance(v, (int, float))]
    others = [v for v in (r["irr_pct"], r["capex_initial"]) if v is not None]
    if not npvs:
        return False
    for c in chunks:
        if _is_toc(c):
            continue
        for v in npvs:
            for p in _positions(c, v, min_digits=3):
                if not re.search(r"NPV", c[max(0, p - 150) : p], re.I):
                    continue
                if not others or any(_positions(c[max(0, p - 600) : p + 600], o) for o in others):
                    return True
    return False


KINDS = {
    "resource": ("core.resource_estimates", "tonnes, grade, category, domain, contained_metal", check_resource),
    "drill": ("core.drill_results", "hole_id, from_m, to_m, interval_m, assays", check_drill),
    "economics": ("core.project_economics", "npv, irr_pct, capex_initial, aisc, study_type", check_econ),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--out", type=Path, help="write rows that failed the check (to read)")
    args = parser.parse_args()

    stats: collections.Counter = collections.Counter()
    to_read: list[dict] = []
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT document_id, content FROM raw.document_chunks
                WHERE document_id IN (SELECT document_id FROM core.resource_estimates WHERE NOT reviewed
                                UNION SELECT document_id FROM core.drill_results WHERE NOT reviewed
                                UNION SELECT document_id FROM core.project_economics WHERE NOT reviewed)"""
        )
        chunks: dict = collections.defaultdict(list)
        for row in cur.fetchall():
            chunks[row["document_id"]].append(row["content"].replace("\xa0", " "))
        for kind, (table, cols, check) in KINDS.items():
            cur.execute(f"SELECT id, document_id, extraction_confidence, {cols} FROM {table} WHERE NOT reviewed")
            ok_ids = []
            for r in cur.fetchall():
                if check(r, chunks.get(r["document_id"], [])):
                    ok_ids.append(r["id"])
                else:
                    to_read.append({"kind": kind, **{k: (str(v) if not isinstance(v, (int, float, dict, list, type(None))) else v) for k, v in r.items()}})
            stats[f"{kind} verified"] = len(ok_ids)
            if args.apply and ok_ids:
                cur.execute(
                    f"""UPDATE {table} SET reviewed = true, review_source = 'auto_source_match',
                           review_note = 'key figures found together in source text'
                         WHERE id = ANY(%s) AND NOT reviewed""",
                    (ok_ids,),
                )
    for r in to_read:
        stats[f"{r['kind']} to read"] += 1
    for k in sorted(stats):
        print(f"{stats[k]:6}  {k}")
    if args.out:
        args.out.write_text(json.dumps(to_read, indent=1, default=str))
        print(f"wrote {len(to_read)} rows to {args.out}")
    if not args.apply:
        print("dry run: nothing changed (pass --apply)")


if __name__ == "__main__":
    main()
