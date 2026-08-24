"""Load BC MinFile / USGS occurrence CSVs and match them to core.projects."""

from __future__ import annotations

import argparse
import csv
import logging
from pathlib import Path
from typing import Optional

from common.db import connection
from common.normalize import normalize_commodities, normalize_project_name

logger = logging.getLogger(__name__)

NAME_KEYS = ("name", "site_name", "deposit_name", "minfile_name", "occurrence")
ID_KEYS = ("external_id", "minfile_number", "dep_id", "site_id", "rec_id", "number")
LAT_KEYS = ("lat", "latitude", "y", "northing_lat")
LNG_KEYS = ("lng", "lon", "long", "longitude", "x")
REGION_KEYS = ("region", "state", "province", "mining_division", "nts")
COUNTRY_KEYS = ("country",)
COMMODITY_KEYS = ("commodities", "commodity", "commod1", "commod2")


def _pick(row: dict[str, str], keys: tuple[str, ...]) -> Optional[str]:
    for key in keys:
        value = (row.get(key) or "").strip()
        if value:
            return value
    return None


def _float(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return None


def _normalize_headers(row: dict[str, str]) -> dict[str, str]:
    return {(k or "").strip().lower().replace(" ", "_"): (v or "").strip() for k, v in row.items()}


def upsert_occurrence(
    *,
    source: str,
    external_id: str,
    name: str,
    lat: float,
    lng: float,
    country: Optional[str],
    region: Optional[str],
    commodities: list[str],
) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO core.geo_occurrences (
                source, external_id, name, country, region, lat, lng, commodities
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source, external_id) DO UPDATE
               SET name = EXCLUDED.name,
                   country = COALESCE(EXCLUDED.country, core.geo_occurrences.country),
                   region = COALESCE(EXCLUDED.region, core.geo_occurrences.region),
                   lat = EXCLUDED.lat,
                   lng = EXCLUDED.lng,
                   commodities = COALESCE(EXCLUDED.commodities, core.geo_occurrences.commodities);
            """,
            (source, external_id, name, country, region, lat, lng, commodities or None),
        )


def load_csv(path: Path, source: str) -> dict[str, int]:
    counts = {"upserted": 0, "skipped": 0}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise SystemExit(f"{path} has no header row")
        for raw in reader:
            row = _normalize_headers(raw)
            name = _pick(row, NAME_KEYS)
            external = _pick(row, ID_KEYS) or name
            lat = _float(_pick(row, LAT_KEYS))
            lng = _float(_pick(row, LNG_KEYS))
            if not name or not external or lat is None or lng is None:
                counts["skipped"] += 1
                continue
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                counts["skipped"] += 1
                continue
            commodities: list[str] = []
            for key in COMMODITY_KEYS:
                blob = row.get(key) or ""
                if blob:
                    commodities.extend(part.strip() for part in blob.replace(";", ",").split(","))
            upsert_occurrence(
                source=source,
                external_id=external[:80],
                name=name[:240],
                lat=lat,
                lng=lng,
                country=_pick(row, COUNTRY_KEYS) or ("Canada" if source == "minfile" else None),
                region=_pick(row, REGION_KEYS),
                commodities=normalize_commodities(commodities),
            )
            counts["upserted"] += 1
    return counts


def match_occurrences() -> dict[str, int]:
    """Unique name (+ optional commodity) matches write lat/lng onto the project."""
    counts = {"linked": 0, "ambiguous": 0, "none": 0}
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, region, commodities
              FROM core.geo_occurrences
             WHERE project_id IS NULL;
            """
        )
        occurrences = list(cur.fetchall())
        cur.execute("SELECT id, name, region, commodities, lat, lng FROM core.projects;")
        projects = list(cur.fetchall())
        indexed: dict[str, list[dict]] = {}
        for project in projects:
            key = normalize_project_name(project["name"])
            indexed.setdefault(key, []).append(project)
        for occ in occurrences:
            key = normalize_project_name(occ["name"])
            candidates = list(indexed.get(key) or [])
            occ_comms = set(occ["commodities"] or [])
            if occ_comms and len(candidates) > 1:
                narrowed = [
                    row
                    for row in candidates
                    if occ_comms & set(row["commodities"] or [])
                ]
                if narrowed:
                    candidates = narrowed
            if occ.get("region") and len(candidates) > 1:
                region = (occ["region"] or "").lower()
                narrowed = [
                    row
                    for row in candidates
                    if region and region in (row.get("region") or "").lower()
                ]
                if len(narrowed) == 1:
                    candidates = narrowed
            if len(candidates) == 0:
                counts["none"] += 1
                continue
            if len(candidates) > 1:
                counts["ambiguous"] += 1
                continue
            project = candidates[0]
            cur.execute(
                "UPDATE core.geo_occurrences SET project_id = %s WHERE id = %s;",
                (project["id"], occ["id"]),
            )
            if project.get("lat") is None or project.get("lng") is None:
                cur.execute(
                    """
                    UPDATE core.projects
                       SET lat = %s, lng = %s, updated_at = now()
                     WHERE id = %s AND lat IS NULL AND lng IS NULL;
                    """,
                    (occ["lat"], occ["lng"], project["id"]),
                )
            counts["linked"] += 1
    return counts


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Load MinFile/USGS occurrences and match projects.")
    parser.add_argument("--source", choices=("minfile", "usgs"))
    parser.add_argument("--file", type=Path)
    parser.add_argument("--match", action="store_true", help="link unmatched occurrences to projects")
    args = parser.parse_args()
    if args.file:
        if not args.source:
            raise SystemExit("--source is required with --file")
        counts = load_csv(args.file, args.source)
        logger.info("geo load %s %s", args.source, counts)
    if args.match:
        logger.info("geo match %s", match_occurrences())
    if not args.file and not args.match:
        raise SystemExit("pass --file and/or --match")


if __name__ == "__main__":
    main()
