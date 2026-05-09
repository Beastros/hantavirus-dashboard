#!/usr/bin/env python3
"""
Outbreak dashboard ingest. Runs every 15 min via GitHub Actions.

Primary sources scraped directly every run:
  - WHO DON page (2026-DON599)
  - Wikipedia MV Hondius outbreak page
  - CDC statement page

These are passed to Claude to extract new cases and diff against known state.

RSS feeds catch broader news signal.

Writes to public/data/:
  news.json              keyword-filtered headlines
  cases-individual.json  per-case demographics (seeded + AI-extracted)
  ingest-status.json     run metadata and source health
  ship-position.json     AIS vessel position (requires AIS_API_KEY)
  trends.json            Google Trends interest data
  last-build.txt         timestamp to force Pages rebuild
"""
from __future__ import annotations

import hashlib
import html as html_stdlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import feedparser
import httpx
import yaml

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "public" / "data"
DATA.mkdir(parents=True, exist_ok=True)

UA = "OutbreakDashboardIngest/0.3 (hantavirus-dashboard; outbreak monitoring)"
HONDIUS_MMSI = "244820778"
DROP_QUERY = frozenset({
    "utm_source", "utm_medium", "utm_campaign",
    "utm_term", "utm_content", "at_medium", "at_campaign",
})
CASE_SIGNALS = {
    "died", "death", "hospitalized", "patient", "confirmed",
    "years old", "woman", "man", "male", "female", "nationality",
    "case", "infected", "positive", "hantavirus",
}


def strip_html_text(raw: str, max_chars: int | None = None) -> str:
    """RSS summaries often ship HTML (Guardian, NYT). Strip tags + entities for plain text."""
    if not raw:
        return ""
    t = re.sub(r"<[^>]+>", " ", raw)
    t = html_stdlib.unescape(t)
    t = re.sub(r"\s+", " ", t).strip()
    if max_chars is not None and len(t) > max_chars:
        t = t[:max_chars].rsplit(" ", 1)[0] + "…"
    return t

# Primary sources to scrape directly every run
PRIMARY_SOURCES = [
    {
        "id": "who-don",
        "name": "WHO DON 2026-DON599",
        "url": "https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON599",
    },
    {
        "id": "wikipedia-hondius",
        "name": "Wikipedia MV Hondius Outbreak",
        "url": "https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak",
    },
    {
        "id": "cdc-statement",
        "name": "CDC Hantavirus Statement",
        "url": "https://www.cdc.gov/media/releases/2026-hantavirus-confirmed-cruise-ship.html",
    },
    {
        "id": "who-response",
        "name": "WHO Response Statement",
        "url": "https://www.who.int/news/item/07-05-2026-who-s-response-to-hantavirus-cases-linked-to-a-cruise-ship",
    },
]

SEED_CASES = [
    {"id":"case-1","case_ref":"case-1","nationality":"Dutch","age":70,"sex":"male",
     "location":"MV Hondius","lat":-42.0,"lng":-35.0,
     "origin_lat":-54.8019,"origin_lng":-68.3030,"cluster_id":"argentina-2026",
     "exposure_event":"MV Hondius voyage departure Ushuaia Apr 1",
     "onset_date":"2026-04-06","outcome":"died",
     "notes":"Index case. Dutch man 70. Died on board April 11. WHO confirmed hantavirus.",
     "source":"manual","source_url":"https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON599"},
    {"id":"case-2","case_ref":"case-2","nationality":"Dutch","age":None,"sex":"female",
     "location":"Johannesburg, South Africa","lat":-26.204,"lng":28.047,
     "origin_lat":-54.8019,"origin_lng":-68.3030,"cluster_id":"argentina-2026",
     "exposure_event":"MV Hondius voyage departure Ushuaia Apr 1",
     "onset_date":"2026-04-24","outcome":"died",
     "notes":"Wife of case 1. Deboarded Saint Helena April 24, died Johannesburg April 26. PCR confirmed.",
     "source":"manual","source_url":"https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON599"},
    {"id":"case-3","case_ref":"case-3","nationality":"British","age":None,"sex":"male",
     "location":"Johannesburg, South Africa","lat":-26.200,"lng":28.052,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":"2026-04-24","outcome":"hospitalized",
     "notes":"Evacuated Ascension Island April 27. PCR confirmed. In ICU improving.",
     "source":"manual","source_url":"https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON599"},
    {"id":"case-4","case_ref":"case-4","nationality":"German","age":None,"sex":"female",
     "location":"MV Hondius","lat":14.933,"lng":-23.513,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":"2026-04-28","outcome":"died",
     "notes":"Died on board May 2. Onset April 28. Under investigation for hantavirus confirmation.",
     "source":"manual","source_url":"https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON599"},
    {"id":"case-5","case_ref":"case-5","nationality":"Dutch","age":41,"sex":"male",
     "location":"Netherlands","lat":52.374,"lng":4.890,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"confirmed",
     "notes":"41-year-old Dutch crew member. Airlifted Cape Verde to Netherlands May 5. WHO confirmed.",
     "source":"manual","source_url":"https://time.com/article/2026/05/07/countries-hantavirus-hondius-cruise-ship/"},
    {"id":"case-6","case_ref":"case-6","nationality":"Unknown","age":None,"sex":None,
     "location":"Netherlands","lat":52.370,"lng":4.896,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"confirmed",
     "notes":"Airlifted Cape Verde to Netherlands May 5. WHO confirmed case.",
     "source":"manual","source_url":"https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON599"},
    {"id":"case-7","case_ref":"case-7","nationality":"Unknown","age":None,"sex":"male",
     "location":"Zurich, Switzerland","lat":47.376,"lng":8.541,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"confirmed",
     "notes":"Confirmed Andes strain at University Hospital Zurich. Passenger on MV Hondius.",
     "source":"manual","source_url":"https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak"},
    {"id":"case-8","case_ref":"case-8","nationality":"French","age":None,"sex":None,
     "location":"France","lat":48.857,"lng":2.352,
     "origin_lat":-26.137,"origin_lng":28.241,"cluster_id":"jnb-flight-apr25",
     "exposure_event":"Airlink flight Saint Helena to Johannesburg Apr 25",
     "onset_date":None,"outcome":"suspected",
     "notes":"RUMOR PING: Contact case. Shared Airlink flight Saint Helena to Johannesburg with case 2. Monitoring only.",
     "source":"manual","source_url":"https://www.aljazeera.com/news/2026/5/6/canary-islands-refuses-to-allow-mv-hondius-with-hantavirus-to-dock"},
    {"id":"case-9","case_ref":"case-9","nationality":"Unknown","age":41,"sex":"female",
     "location":"Amsterdam, Netherlands","lat":52.378,"lng":4.901,
     "origin_lat":-26.137,"origin_lng":28.241,"cluster_id":"jnb-flight-apr25",
     "exposure_event":"Airlink flight Saint Helena to Johannesburg Apr 25",
     "onset_date":"2026-05-07","outcome":"suspected",
     "notes":"RUMOR PING: KLM flight attendant on Apr 26 JNB-AMS flight. Admitted Amsterdam UMC May 7. Tests pending.",
     "source":"manual","source_url":"https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak"},
    {"id":"case-10","case_ref":"case-10","nationality":"Singaporean","age":67,"sex":None,
     "location":"Singapore","lat":1.352,"lng":103.820,
     "origin_lat":-26.137,"origin_lng":28.241,"cluster_id":"jnb-flight-apr25",
     "exposure_event":"Airlink flight Saint Helena to Johannesburg Apr 25",
     "onset_date":None,"outcome":"suspected",
     "notes":"RUMOR PING: Disembarked early. On Apr 25 Johannesburg flight with confirmed case. Isolated, runny nose. Tests pending.",
     "source":"manual","source_url":"https://time.com/article/2026/05/07/countries-hantavirus-hondius-cruise-ship/"},
    {"id":"case-11","case_ref":"case-11","nationality":"Singaporean","age":65,"sex":None,
     "location":"Singapore","lat":1.348,"lng":103.826,
     "origin_lat":-26.137,"origin_lng":28.241,"cluster_id":"jnb-flight-apr25",
     "exposure_event":"Airlink flight Saint Helena to Johannesburg Apr 25",
     "onset_date":None,"outcome":"suspected",
     "notes":"RUMOR PING: Disembarked early. On Apr 25 Johannesburg flight with confirmed case. Isolated, asymptomatic. Tests pending.",
     "source":"manual","source_url":"https://time.com/article/2026/05/07/countries-hantavirus-hondius-cruise-ship/"},
    {"id":"case-12","case_ref":"case-12","nationality":"British","age":None,"sex":None,
     "location":"Tristan da Cunha","lat":-37.069,"lng":-12.311,
     "origin_lat":-37.069,"origin_lng":-12.311,"cluster_id":"tristan-visit",
     "exposure_event":"Shore visit / contact Tristan da Cunha",
     "onset_date":None,"outcome":"suspected",
     "notes":"Suspected case with Tristan da Cunha link; monitoring per outbreak reporting.",
     "source":"manual","source_url":"https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON599"},
    {"id":"case-13","case_ref":"case-13","nationality":"American","age":None,"sex":None,
     "location":"Phoenix, Arizona, USA","lat":33.448,"lng":-112.074,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"suspected",
     "notes":"Suspected US domestic monitoring case (Arizona) tied to MV Hondius outbreak cluster.",
     "source":"manual","source_url":"https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak"},
    {"id":"case-14","case_ref":"case-14","nationality":"American","age":None,"sex":None,
     "location":"Atlanta, Georgia, USA","lat":33.749,"lng":-84.388,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"suspected",
     "notes":"Suspected US domestic monitoring (metro Atlanta); ties to MV Hondius outbreak cluster.",
     "source":"manual","source_url":"https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak"},
    {"id":"case-15","case_ref":"case-15","nationality":"American","age":None,"sex":None,
     "location":"Savannah, Georgia, USA","lat":32.081,"lng":-81.091,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"suspected",
     "notes":"Suspected US domestic monitoring (coastal Georgia); ties to MV Hondius outbreak cluster.",
     "source":"manual","source_url":"https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak"},
    {"id":"case-16","case_ref":"case-16","nationality":"American","age":None,"sex":None,
     "location":"Los Angeles, California, USA","lat":34.052,"lng":-118.244,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"suspected",
     "notes":"Suspected US domestic monitoring case (California) tied to MV Hondius outbreak cluster.",
     "source":"manual","source_url":"https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak"},
    {"id":"case-17","case_ref":"case-17","nationality":"American","age":None,"sex":None,
     "location":"Omaha, Nebraska, USA","lat":41.257,"lng":-95.935,
     "origin_lat":14.933,"origin_lng":-23.513,"cluster_id":"hondius-ship",
     "exposure_event":"MV Hondius Cape Verde anchor event",
     "onset_date":None,"outcome":"suspected",
     "notes":"Suspected US domestic monitoring case (Omaha, NE) tied to MV Hondius outbreak cluster.",
     "source":"manual","source_url":"https://en.wikipedia.org/wiki/MV_Hondius_hantavirus_outbreak"},
]


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


def fetch_text(client: httpx.Client, url: str) -> str | None:
    try:
        r = client.get(url, timeout=30.0)
        r.raise_for_status()
        return r.text
    except Exception as exc:
        print(f"[warn] fetch failed {url!r}: {exc}")
        return None


def fetch_bytes(client: httpx.Client, url: str) -> bytes | None:
    try:
        r = client.get(url, timeout=30.0)
        r.raise_for_status()
        return r.content
    except Exception as exc:
        print(f"[warn] fetch failed {url!r}: {exc}")
        return None


# â”€â”€ Primary source scraping + Claude diffing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def scrape_primary_sources(client: httpx.Client, existing_cases: list, already_processed: set) -> tuple[list, set]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[info] No ANTHROPIC_API_KEY - skipping primary source scraping")
        return existing_cases, already_processed

    try:
        import anthropic
        ac = anthropic.Anthropic(api_key=api_key)
    except ImportError:
        print("[warn] anthropic not installed")
        return existing_cases, already_processed

    known_ids = {c["id"] for c in existing_cases}
    updated = list(existing_cases)
    newly_processed = set()

    # Build current case summary to give Claude context
    current_summary = json.dumps([
        {"id": c["id"], "nationality": c.get("nationality"), "outcome": c.get("outcome"),
         "location": c.get("location"), "age": c.get("age"), "sex": c.get("sex")}
        for c in existing_cases
    ], indent=2)

    for src in PRIMARY_SOURCES:
        src_id = f"primary-{src['id']}"
        if src_id in already_processed:
            continue

        print(f"[scrape] {src['name']}")
        html = fetch_text(client, src["url"])
        if not html:
            continue

        # Strip HTML tags roughly for Claude context
        import re
        text = re.sub(r'<[^>]+>', ' ', html)
        text = re.sub(r'\s+', ' ', text).strip()
        text = text[:6000]  # Limit to 6000 chars

        try:
            msg = ac.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1000,
                messages=[{
                    "role": "user",
                    "content": f"""You are tracking a hantavirus outbreak on the MV Hondius cruise ship.

Current known cases in our registry:
{current_summary}

Here is fresh content from {src['name']}:
{text}

Extract ANY new or updated individual case information not already captured above.
For each new case or update, return a JSON array. Empty array [] if nothing new.

Schema: [{{"id":"case-N","case_ref":"case-N","nationality":"string or null","age":null or number,"sex":null or "male" or "female","location":"string","onset_date":null or "YYYY-MM-DD","outcome":"confirmed or died or hospitalized or suspected or recovered","notes":"brief factual note - prefix RUMOR PING if unconfirmed","source":"ai-extracted","source_url":"{src['url']}"}}]

Rules:
- Only extract INDIVIDUALS with specific details mentioned
- If an existing case gets a confirmed outcome upgrade (suspected -> confirmed), include it with the existing ID
- New confirmed WHO cases: outcome = confirmed or died
- Unverified monitoring cases: outcome = suspected, notes prefixed with RUMOR PING
- Return ONLY the JSON array, nothing else"""
                }]
            )

            raw = msg.content[0].text.strip()
            start, end = raw.find("["), raw.rfind("]") + 1
            if start >= 0 and end > start:
                extracted = json.loads(raw[start:end])
                for case in extracted:
                    if not isinstance(case, dict):
                        continue
                    cid = case.get("id") or f"ai-{stable_id(str(case))}"
                    case["id"] = cid

                    if cid in known_ids:
                        # Update existing case with new info
                        for ec in updated:
                            if ec["id"] == cid:
                                for k, v in case.items():
                                    if v is not None and (ec.get(k) is None or k in ("outcome", "notes")):
                                        ec[k] = v
                                print(f"[update] {cid}: {case.get('outcome')} - {case.get('location')}")
                    else:
                        # New case
                        updated.append(case)
                        known_ids.add(cid)
                        print(f"[new case] {cid}: {case.get('nationality')} {case.get('outcome')} in {case.get('location')}")

                if extracted:
                    print(f"[ok] {src['name']}: {len(extracted)} case updates/additions")
                else:
                    print(f"[ok] {src['name']}: no new cases found")

            newly_processed.add(src_id)

        except Exception as exc:
            print(f"[warn] Claude scrape error on {src['id']}: {exc}")
            newly_processed.add(src_id)

    return updated, already_processed | newly_processed


# â”€â”€ RSS ingest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
            title = strip_html_text((entry.get("title") or "").strip())
            summary_raw = entry.get("summary") or entry.get("description") or ""
            summary = strip_html_text(summary_raw, max_chars=420) if summary_raw else ""
            link = entry.get("link") or ""
            if not title or not link:
                continue
            if keywords and not text_matches(f"{title}\n{summary_raw}", keywords):
                continue
            norm = normalize_url(link)
            published = None
            for attr in ("published_parsed", "updated_parsed"):
                pp = entry.get(attr)
                if pp:
                    try:
                        published = datetime(*pp[:6], tzinfo=timezone.utc).isoformat()
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
                "summary": summary or None,
            })
    return items, status


def merge_news(existing, incoming, max_items=200):
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
        key=lambda x: (x.get("published_at") or "1970-01-01", x.get("title") or ""),
        reverse=True,
    )
    return merged[:max_items]


# â”€â”€ RSS article extraction (secondary) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def extract_from_rss(articles, existing_cases, already_processed):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return existing_cases, already_processed

    try:
        import anthropic
        ac = anthropic.Anthropic(api_key=api_key)
    except ImportError:
        return existing_cases, already_processed

    known_ids = {c["id"] for c in existing_cases}
    updated = list(existing_cases)
    newly_done = set()
    calls = 0

    for art in articles:
        if calls >= 5:
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
                max_tokens=400,
                messages=[{
                    "role": "user",
                    "content": (
                        "Extract individual hantavirus case details from this article. "
                        "Return ONLY a JSON array (empty [] if no specific individuals). "
                        'Schema: [{"id":"ai-X","case_ref":null,"age":null or number,'
                        '"sex":null or "male" or "female","nationality":null or "string",'
                        '"outcome":"confirmed or died or hospitalized or suspected",'
                        '"location":null or "string","onset_date":null or "YYYY-MM-DD",'
                        '"notes":"brief note","source":"ai-extracted","source_url":"' + (art.get("url") or "") + '"}]\n\n'
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
                    cid = case.get("id") or f"ai-{stable_id(text[:80])}"
                    case["id"] = cid
                    if cid not in known_ids:
                        updated.append(case)
                        known_ids.add(cid)
                        print(f"[rss extract] new: {cid} {case.get('outcome')} {case.get('location')}")
            newly_done.add(aid)
            calls += 1
        except Exception as exc:
            print(f"[warn] RSS extract error {aid}: {exc}")
            newly_done.add(aid)

    return updated, already_processed | newly_done


# â”€â”€ Google Trends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


# â”€â”€ AIS ship position â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


# â”€â”€ main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def main():
    cfg = yaml.safe_load((ROOT / "sources.yaml").read_text(encoding="utf-8"))
    keywords = cfg.get("keywords") or []
    sources = cfg.get("sources") or []

    existing_news = load_json(DATA / "news.json", {}).get("items", [])
    existing_news = [x for x in existing_news if x.get("id") != "seed-example-1"]

    existing_ci = load_json(DATA / "cases-individual.json", {"cases": []})
    existing_cases_from_file = existing_ci.get("cases", [])

    # Always ensure seed cases are present
    seed_ids = {c["id"] for c in SEED_CASES}
    extra_cases = [c for c in existing_cases_from_file if c.get("id") not in seed_ids]
    existing_cases = list(SEED_CASES) + extra_cases

    prev_status = load_json(DATA / "ingest-status.json", {})
    already_processed = set(prev_status.get("processed_for_cases", []))

    source_status = {}
    ship = None

    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True) as client:
        # 1. Scrape primary sources with Claude diffing (most important)
        print("[phase 1] Primary source scraping...")
        existing_cases, already_processed = scrape_primary_sources(
            client, existing_cases, already_processed
        )

        # 2. RSS feeds
        print("[phase 2] RSS ingest...")
        incoming, source_status = ingest_rss(client, sources, keywords)

        # 3. Ship position
        ship = fetch_ship_position(client)

    # 4. RSS article extraction (secondary signal)
    print("[phase 3] RSS article extraction...")
    existing_cases, already_processed = extract_from_rss(
        incoming, existing_cases, already_processed
    )

    # 5. Merge news
    merged_news = merge_news(existing_news, incoming)
    (DATA / "news.json").write_text(
        json.dumps({"fetched_at": now_iso(), "items": merged_news}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] news.json: {len(merged_news)} items")

    # 6. Write cases
    (DATA / "cases-individual.json").write_text(
        json.dumps({"updated": now_iso(), "cases": existing_cases}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] cases-individual.json: {len(existing_cases)} cases")

    # 7. Ship position
    if ship:
        (DATA / "ship-position.json").write_text(
            json.dumps(ship, indent=2) + "\n", encoding="utf-8"
        )
        print(f"[ok] ship-position.json: {ship.get('lat')}, {ship.get('lng')}")

    # 8. Trends
    trend_kw = [k for k in keywords if '"' not in k and " " not in k][:3] or ["hantavirus"]
    trends = fetch_trends(trend_kw)
    (DATA / "trends.json").write_text(
        json.dumps(trends, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[ok] trends.json: {len(trends.get('timeseries', []))} points")

    # 9. Status
    ok_n = sum(1 for v in source_status.values() if v == "ok")
    fail_n = sum(1 for v in source_status.values() if v == "failed")
    (DATA / "ingest-status.json").write_text(
        json.dumps({
            "last_run": now_iso(),
            "sources_ok": ok_n,
            "sources_failed": fail_n,
            "source_detail": source_status,
            "news_count": len(merged_news),
            "case_count": len(existing_cases),
            "processed_for_cases": sorted(already_processed),
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] status: {ok_n} ok / {fail_n} failed / {len(existing_cases)} cases")

    # 10. Force Pages rebuild
    (DATA / "last-build.txt").write_text(now_iso() + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
