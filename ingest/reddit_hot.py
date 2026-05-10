#!/usr/bin/env python3
"""Fetch /r/{subreddit}/hot.json + /new.json → ../public/data/reddit_hot.json.

Falls back to Reddit RSS (.rss) when JSON returns empty (common from CI IPs / bot filtering).
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

import feedparser
import httpx

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "public" / "data"
OUT_PATH = DATA / "reddit_hot.json"

SUBREDDIT = os.environ.get("REDDIT_SUBREDDIT", "hantavirus").strip().lstrip("r/").lstrip("/")
LIMIT = min(max(int(os.environ.get("REDDIT_HOT_LIMIT", "18")), 5), 35)

# Reddit often empties JSON listings for generic/bot UAs from datacenter IPs.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


def _parse_listing(payload: object) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    data_block = payload.get("data")
    if not isinstance(data_block, dict):
        return []
    children = data_block.get("children") or []
    if not isinstance(children, list):
        return []
    items: list[dict] = []
    for ch in children:
        if not isinstance(ch, dict):
            continue
        d = cast(dict[str, Any], ch.get("data") or {})
        permalink = d.get("permalink") or ""
        if not permalink.startswith("/"):
            permalink = "/" + permalink
        reddit_url = "https://www.reddit.com" + permalink
        title = (d.get("title") or "").strip()
        if not title:
            continue
        items.append(
            {
                "id": d.get("name") or d.get("id") or permalink,
                "title": title,
                "reddit_url": reddit_url,
                "score": int(d.get("score") or 0),
                "num_comments": int(d.get("num_comments") or 0),
                "created_utc": d.get("created_utc"),
                "author": (d.get("author") or "")[:80] or None,
                "link_flair_text": (d.get("link_flair_text") or "").strip() or None,
            },
        )
    return items


def _fetch_sort_json(client: httpx.Client, sort: str) -> list[dict]:
    url = f"https://www.reddit.com/r/{SUBREDDIT}/{sort}.json"
    params = {"raw_json": "1", "limit": str(LIMIT)}
    r = client.get(url, params=params)
    r.raise_for_status()
    ctype = (r.headers.get("content-type") or "").lower()
    if "application/json" not in ctype and "json" not in ctype:
        print(f"[warn] reddit {sort}.json unexpected content-type: {ctype!r}")
    try:
        payload = r.json()
    except json.JSONDecodeError as e:
        print(f"[warn] reddit {sort}.json not JSON: {e}")
        return []
    parsed = _parse_listing(payload)
    if not parsed:
        # Help debug silent empty listings
        raw = payload if isinstance(payload, dict) else {}
        err = raw.get("error") if isinstance(raw.get("error"), (int, str)) else None
        msg = raw.get("message") if isinstance(raw.get("message"), str) else None
        if err or msg:
            print(f"[warn] reddit {sort} API error payload: error={err!r} message={msg!r}")
    return parsed


def _stable_id(url: str, title: str) -> str:
    h = hashlib.sha256(f"{url}\n{title}".encode()).hexdigest()[:16]
    return f"rss-{h}"


def _fetch_sort_rss(sort: str) -> list[dict]:
    """Fallback when .json returns no posts (blocked / empty listing)."""
    url = f"https://www.reddit.com/r/{SUBREDDIT}/{sort}.rss?limit={LIMIT}"
    parsed = feedparser.parse(url)
    if getattr(parsed, "bozo", False) and not parsed.entries:
        print(f"[warn] reddit {sort}.rss parse issue: {getattr(parsed, 'bozo_exception', '')}")
    items: list[dict] = []
    for entry in parsed.entries[:LIMIT]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        items.append(
            {
                "id": _stable_id(link, title),
                "title": title,
                "reddit_url": link,
                "score": 0,
                "num_comments": 0,
                "created_utc": None,
                "author": None,
                "link_flair_text": None,
                "source": "rss_fallback",
            },
        )
    print(f"[info] reddit {sort}.rss → {len(items)} items")
    return items


def _merge_reddit_into_ingest_status(
    fetched_iso: str,
    hot_n: int,
    new_n: int,
) -> None:
    path = DATA / "ingest-status.json"
    if not path.exists():
        return
    try:
        st = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    st["reddit_intel"] = {
        "fetched_at": fetched_iso,
        "subreddit": SUBREDDIT,
        "hot_count": hot_n,
        "new_count": new_n,
    }
    path.write_text(json.dumps(st, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    hot_items: list[dict] = []
    new_items: list[dict] = []
    json_ok = False
    try:
        with httpx.Client(
            headers={
                "User-Agent": UA,
                "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            follow_redirects=True,
            timeout=30.0,
        ) as client:
            hot_items = _fetch_sort_json(client, "hot")
            new_items = _fetch_sort_json(client, "new")
            json_ok = True
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] reddit JSON fetch failed: {exc}")

    if not hot_items:
        hot_items = _fetch_sort_rss("hot")
    if not new_items:
        new_items = _fetch_sort_rss("new")

    note_extra = ""
    if hot_items and hot_items[0].get("source") == "rss_fallback":
        note_extra = " JSON empty — filled HOT from RSS."
    if new_items and new_items[0].get("source") == "rss_fallback":
        note_extra += " NEW from RSS."

    fetched_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    payload = {
        "fetched_at": fetched_iso,
        "subreddit": SUBREDDIT,
        "note": (
            f"Mirrors r/{SUBREDDIT} hot + new (JSON preferred; RSS fallback if Reddit strips listings). "
            "Scores/comments may be 0 on RSS rows."
            + note_extra
        ),
        "sources": {
            "hot": {
                "feed_url": f"https://www.reddit.com/r/{SUBREDDIT}/hot/",
                "items": hot_items,
            },
            "new": {
                "feed_url": f"https://www.reddit.com/r/{SUBREDDIT}/new/",
                "items": new_items,
            },
        },
        "feed_url": f"https://www.reddit.com/r/{SUBREDDIT}/hot/",
        "items": hot_items,
        "fetch_meta": {
            "json_attempted": json_ok,
            "hot_via": "rss_fallback" if hot_items and hot_items[0].get("source") == "rss_fallback" else "json",
            "new_via": "rss_fallback" if new_items and new_items[0].get("source") == "rss_fallback" else "json",
        },
    }
    DATA.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    _merge_reddit_into_ingest_status(fetched_iso, len(hot_items), len(new_items))
    nuniq = len({p["id"] for p in hot_items + new_items})
    print(f"[ok] wrote {OUT_PATH} (hot={len(hot_items)} new={len(new_items)} unique≈{nuniq})")


if __name__ == "__main__":
    main()
