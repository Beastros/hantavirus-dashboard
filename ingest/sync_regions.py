"""Roll up cases-individual.json into cases.json region counts each ingest run."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

# (region_id, location substrings — first match wins)
_LOCATION_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("ar-ushuaia", ("ushuaia", "argentina")),
    ("sh-saint-helena", ("saint helena",)),
    ("sh-ascension", ("ascension",)),
    ("cv-cape-verde", ("cape verde", "hondius", "cruise ship", "mv ")),
    ("za-johannesburg", ("johannesburg", "south africa")),
    ("nl-netherlands", ("netherlands", "amsterdam", "dutch", "rotterdam")),
    ("ch-zurich", ("zurich", "switzerland")),
    ("fr-france", ("france", "french", "paris")),
    ("sg-singapore", ("singapore")),
    ("us-arizona", ("arizona", "phoenix")),
    ("us-georgia", ("georgia", "atlanta", "savannah")),
    ("us-california", ("california", "los angeles")),
    ("us-omaha", ("omaha", "nebraska")),
    ("es-tenerife", ("tenerife", "canary", "spain", "granadilla")),
    ("uk-london", ("london", "guys", "st thomas", "nhs", "united kingdom", "british")),
    ("uk-tristan", ("tristan",)),
    ("ca-canada", ("canada", "canadian", "ontario", "british columbia", "vancouver")),
    ("uy-uruguay", ("uruguay",)),
    ("cl-chile", ("chile",)),
]


def _should_skip_case(case: dict[str, Any]) -> bool:
    if case.get("source") != "ai-extracted":
        return False
    note = str(case.get("notes") or "").lower()
    if "deaths reported" in note and "3 deaths" in note:
        return True
    if not case.get("nationality") and case.get("age") is None and not case.get("sex"):
        if str(case.get("location") or "").lower() in ("cruise ship", "mv hondius"):
            return True
    return False


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, a)))


def region_id_for_case(case: dict[str, Any], regions: list[dict[str, Any]]) -> str | None:
    loc = str(case.get("location") or "").lower()
    for rid, keys in _LOCATION_RULES:
        if any(k in loc for k in keys):
            return rid

    nat = str(case.get("nationality") or "").lower()
    if "dutch" in nat and "netherlands" not in loc:
        return "nl-netherlands"
    if "british" in nat and "tristan" not in loc:
        return "uk-london"
    if "german" in nat:
        return "cv-cape-verde"
    if "french" in nat:
        return "fr-france"
    if "american" in nat or "singaporean" in nat:
        pass  # fall through to geo

    lat, lng = case.get("lat"), case.get("lng")
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        return None

    best_id: str | None = None
    best_km = 1e9
    for reg in regions:
        try:
            rlat, rlng = float(reg["lat"]), float(reg["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        km = _haversine_km(lat_f, lng_f, rlat, rlng)
        if km < best_km:
            best_km = km
            best_id = str(reg["id"])
    if best_id and best_km <= 800:
        return best_id
    return None


def rollup_regions(
    registry: list[dict[str, Any]],
    regions_template: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, int]] = {
        str(r["id"]): {"suspected": 0, "probable": 0, "confirmed": 0, "deaths": 0}
        for r in regions_template
    }

    for case in registry:
        if _should_skip_case(case):
            continue
        rid = region_id_for_case(case, regions_template)
        if not rid or rid not in totals:
            continue
        outcome = str(case.get("outcome") or "")
        bucket = totals[rid]
        if outcome == "died":
            bucket["deaths"] += 1
        elif outcome == "confirmed":
            bucket["confirmed"] += 1
        elif outcome in ("suspected", "hospitalized"):
            bucket["suspected"] += 1

    rolled: list[dict[str, Any]] = []
    for reg in regions_template:
        rid = str(reg["id"])
        t = totals[rid]
        row = dict(reg)
        row["suspected"] = t["suspected"]
        row["probable"] = t["probable"]
        row["confirmed"] = t["confirmed"]
        row["deaths"] = t["deaths"]
        if t["deaths"] > 0 or t["confirmed"] >= 2:
            row["outbreak_level"] = "high"
        elif t["confirmed"] > 0 or t["suspected"] > 0:
            if row.get("outbreak_level") == "informational":
                row["outbreak_level"] = "elevated"
        rolled.append(row)
    return rolled


def sync_cases_json(
    data_dir: Path,
    registry: list[dict[str, Any]],
    *,
    updated_iso: str,
) -> dict[str, Any]:
    path = data_dir / "cases.json"
    base = json.loads(path.read_text(encoding="utf-8-sig"))
    regions_tpl = base.get("regions") or []
    if not isinstance(regions_tpl, list):
        regions_tpl = []

    payload = {
        "updated": updated_iso,
        "disclaimer": (
            "Personal signal tracker. Region counts auto-synced from cases-individual.json each ingest; "
            "notes on regions are preserved from the ledger template."
        ),
        "regions": rollup_regions(registry, regions_tpl),
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload
