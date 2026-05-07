#!/usr/bin/env python3
"""
Outbreak dashboard ingest. Runs every 15 min via GitHub Actions.

Writes to public/data/:
  news.json              keyword-filtered headlines
  cases-individual.json  per-case demographics (seeded + AI-extracted)
  ingest-status.json     run metadata and source health
  ship-position.json     AIS vessel position (requires AIS_API_KEY)
  trends.json            Google Trends interest data
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import feedparser
import httpx
import yaml

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "public" / "data"
DATA.mkdir(parents=True, exist_ok=True)

UA = "OutbreakDashboardIngest/0.2 (hantavirus-dashboard)"
HONDIUS_MMSI = "244820778"
DROP_QUERY = frozenset({
    "utm_source", "utm_medium", "utm_campaign",
    "utm_term", "utm_content", "at_medium", "at_campaign",
})
CASE_SIGNALS = {
    "died", "death", "hospitalized", "patient", "confirmed",
    "years old", "woman", "man", "male", "female", "nationality",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_url(url: str) -> str:
    p = urlparse(url.strip())
    q = [pair for pair in (p.query or "").split("&")
         if pair and pair.split("=", 1)[0].lower() not in DROP_QUERY]
    return urlunparse((p.scheme, p.netloc, p.path, p.params, "&".join(q), ""))


def stable_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def text_matches(text: str, keywords: list) -> bool:
    hay = text.lower()
    return any(k.lower() in hay for k in keywords)


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"[warn] bad JSON at {path}")
    return default


def fetch_bytes(client: httpx.Client, url: str):
    try:
        r = client.get(url, timeout=30.0)
        r.raise_for_status()
        return r.content
    except Exception as exc:
        print(f"[warn] fetch failed {url!r}: {exc}")
        return None


# â”€â”€ RSS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def ingest_rss(client, sources, keywords):
    items, status = [], {}
    for src in sources:
        url = src.get("rss_url")
        if not url:
            continue
        raw = fetch_bytes(client, url)
        if raw is None:
            status[src["id"]] = "failed"
            continue
        status[src["id"]] = "ok"
        parsed = feedparser.parse(raw)
        for entry in parsed.entries:
            title = (entry.get("title") or "").strip()
            summary = entry.get("summary") or entry.get("description") or ""
            link = entry.get("link") or ""
            if not title or not link:
                continue
            if keywords and not text_matches(f"{title}\n{summary}", keywords):
                continue
            norm = normalize_url(link)
            published = None
            for attr in ("published_parsed", "updated_parsed"):
                pp = entry.get(attr)
                if pp:
                    try:
                        published = datetime(*pp[:6], tzinfo=timezone.utc).date().isoformat()
                        break
                    except Exception:
                        pass
            items.append({
                "id": stable_id(norm),
                "title": title,
                "url": norm,
                "published_at": published,
                "source_name": src.get("name") or src["id"],
                "source_tier": int(src.get("tier") or 2),
                "summary": summary[:400] if summary else None,
            })
    return items, status


def merge_news(existing, incoming, max_items=150):
    by_url = {}
    for row in existing + incoming:
        u = normalize_url(row.get("url") or "")
        if not u:
            continue
        prev = by_url.get(u)
        if prev is None:
            row["url"] = u
            by_url[u] = row
        elif (row.get("source_tier", 99), -len(row.get("title", ""))) < \
             (prev.get("source_tier", 99), -len(prev.get("title", ""))):
            row["url"] = u
            by_url[u] = row
    merged = sorted(
        by_url.values(),
        key=lambda x: (x.get("published_at") or "", x.get("title") or ""),
        reverse=True,
    )
    return merged[:max_items]


# â”€â”€ AIS ship position â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def fetch_ship_position(client):
    key = os.environ.get("AIS_API_KEY")
    if not key:
        return None
    try:
        r = client.get(
            f"https://api.aisstream.io/v0/vessel/{HONDIUS_MMSI}",
            headers={"Authorization": f"Bearer {key}"},
            timeout=15.0,
        )
        r.raise_for_status()
        d = r.json()
        return {
            "fetched_at": now_iso(),
            "mmsi": HONDIUS_MMSI,
            "name": d.get("name") or "MV HONDIUS",
            "lat": d.get("latitude"),
            "lng": d.get("longitude"),
            "speed": d.get("speed"),
            "course": d.get("course"),
            "status": d.get("navigationalStatus") or "unknown",
            "destination": d.get("destination"),
            "source": "aisstream",
        }
    except Exception as exc:
        print(f"[warn] AIS fetch failed: {exc}")
        return None


# â”€â”€ Google Trends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def fetch_trends(kw):
    try:
        from pytrends.request import TrendReq
        pt = TrendReq(hl="en-US", tz=0, timeout=(10, 25), retries=2, backoff_factor=0.5)
        terms = kw[:5]
        pt.build_payload(terms, timeframe="now 7-d", geo="")
        df = pt.interest_over_time()
        if df.empty:
            return {"fetched_at": now_iso(), "keywords": terms, "timeseries": [], "regional": []}
        try:
            reg_df = pt.interest_by_region(resolution="COUNTRY", inc_low_vol=False)
            regional = []
            for geo_code, row in reg_df.iterrows():
                vals = {k: int(row[k]) for k in terms if k in row}
                if any(v > 0 for v in vals.values()):
                    regional.append({"geo": str(geo_code), **vals})
            regional.sort(key=lambda x: -sum(v for v in x.values() if isinstance(v, int)))
            regional = regional[:20]
        except Exception:
            regional = []
        ts = [
            {"date": str(dt.date()), **{k: int(row[k]) for k in terms if k in row}}
            for dt, row in df.iterrows()
        ]
        return {"fetched_at": now_iso(), "keywords": terms, "timeseries": ts, "regional": regional}
    except Exception as exc:
        print(f"[warn] Google Trends failed: {exc}")
        return {"fetched_at": now_iso(), "keywords": kw[:5], "timeseries": [], "regional": [], "error": str(exc)}


# â”€â”€ Claude case extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def extract_cases_claude(articles, existing_cases, already_processed):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return existing_cases, already_processed
    try:
        import anthropic
        ac = anthropic.Anthropic(api_key=api_key)
    except ImportError:
        print("[warn] anthropic not installed")
        return existing_cases, already_processed

    updated = list(existing_cases)
    known_ids = {c["id"] for c in updated}
    newly_done = set()
    calls = 0

    for art in articles:
        if calls >= 8:
            break
        aid = art.get("id", "")
        if not aid or aid in already_processed:
            continue
        text = f"{art.get('title', '')}\n{art.get('summary', '')}"
        if not any(s in text.lower() for s in CASE_SIGNALS):
            newly_done.add(aid)
            continue
        try:
            msg = ac.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=600,
                messages=[{
                    "role": "user",
                    "content": (
                        "Extract individual hantavirus case details from this article. "
                        "Return ONLY a JSON array (empty [] if no specific individuals mentioned). "
                        'Schema: [{"case_ref":"string or null","age":null or number,'
                        '"sex":null or "male" or "female","nationality":null or "string",'
                        '"outcome":null or "confirmed" or "hospitalized" or "died" or "recovered" or "suspected",'
                        '"location":null or "string","onset_date":null or "YYYY-MM-DD"}]\n\n'
                        f"Article:\n{text[:1500]}"
                    ),
                }],
            )
            raw = msg.content[0].text.strip()
            start, end = raw.find("["), raw.rfind("]") + 1
            if start >= 0 and end > start:
                for case in json.loads(raw[start:end]):
                    if not isinstance(case, dict):
                        continue
                    cid = case.get("case_ref") or f"ai-{stable_id(text[:80])}"
                    if cid in known_ids:
                        for ec in updated:
                            if ec["id"] == cid:
                                for k, v in case.items():
                                    if v is not None and ec.get(k) is None:
                                        ec[k] = v
                    else:
                        case["id"] = cid
                        case["source"] = "ai-extracted"
                        case["source_url"] = art.get("url")
                        updated.append(case)
                        known_ids.add(cid)
            newly_done.add(aid)
            calls += 1
        except Exception as exc:
            print(f"[warn] Claude extraction error on {aid}: {exc}")
            newly_done.add(aid)

    return updated, already_processed | newly_done


# â”€â”€ main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def main():
    cfg = yaml.safe_load((ROOT / "sources.yaml").read_text(encoding="utf-8"))
    keywords = cfg.get("keywords") or []
    sources = cfg.get("sources") or []

    existing_news = load_json(DATA / "news.json", {}).get("items", [])
    existing_news = [x for x in existing_news if x.get("id") != "seed-example-1"]

    existing_ci = load_json(DATA / "cases-individual.json", {"cases": []})
    existing_cases = existing_ci.get("cases", [])

    prev_status = load_json(DATA / "ingest-status.json", {})
    already_processed = set(prev_status.get("processed_for_cases", []))

    source_status = {}
    ship = None

    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True) as client:
        incoming, source_status = ingest_rss(client, sources, keywords)
        ship = fetch_ship_position(client)

    # News
    merged = merge_news(existing_news, incoming)
    (DATA / "news.json").write_text(
        json.dumps({"fetched_at": now_iso(), "items": merged}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] news.json: {len(merged)} items")

    # Case extraction
    updated_cases, new_processed = extract_cases_claude(incoming, existing_cases, already_processed)
    (DATA / "cases-individual.json").write_text(
        json.dumps({"updated": now_iso(), "cases": updated_cases}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] cases-individual.json: {len(updated_cases)} cases")

    # Ship position
    if ship:
        (DATA / "ship-position.json").write_text(
            json.dumps(ship, indent=2) + "\n", encoding="utf-8"
        )
        print(f"[ok] ship-position.json: {ship.get('lat')}, {ship.get('lng')}")

    # Trends
    trend_kw = [k for k in keywords if '"' not in k and " " not in k][:3] or ["hantavirus"]
    trends = fetch_trends(trend_kw)
    (DATA / "trends.json").write_text(
        json.dumps(trends, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[ok] trends.json: {len(trends.get('timeseries', []))} points")

    # Status
    ok_n = sum(1 for v in source_status.values() if v == "ok")
    fail_n = sum(1 for v in source_status.values() if v == "failed")
    (DATA / "ingest-status.json").write_text(
        json.dumps({
            "last_run": now_iso(),
            "sources_ok": ok_n,
            "sources_failed": fail_n,
            "source_detail": source_status,
            "news_count": len(merged),
            "case_count": len(updated_cases),
            "processed_for_cases": sorted(new_processed),
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] ingest-status.json: {ok_n} ok / {fail_n} failed")


if __name__ == "__main__":
    main()
