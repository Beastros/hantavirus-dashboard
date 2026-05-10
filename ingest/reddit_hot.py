#!/usr/bin/env python3
"""Fetch /r/{subreddit}/hot.json + /new.json → ../public/data/reddit_hot.json."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

import httpx

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "public" / "data"
OUT_PATH = DATA / "reddit_hot.json"

SUBREDDIT = os.environ.get("REDDIT_SUBREDDIT", "hantavirus").strip().lstrip("r/").lstrip("/")
LIMIT = min(max(int(os.environ.get("REDDIT_HOT_LIMIT", "18")), 5), 35)

UA = (
    "Mozilla/5.0 (compatible; BeastrosHantavirusDashboard/1.0; "
    "+https://github.com/Beastros/hantavirus-dashboard)"
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


def _fetch_sort(client: httpx.Client, sort: str) -> list[dict]:
    url = f"https://www.reddit.com/r/{SUBREDDIT}/{sort}.json"
    params = {"raw_json": "1", "limit": str(LIMIT)}
    r = client.get(url, params=params)
    r.raise_for_status()
    return _parse_listing(r.json())


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
    try:
        with httpx.Client(
            headers={"User-Agent": UA},
            follow_redirects=True,
            timeout=30.0,
        ) as client:
            hot_items = _fetch_sort(client, "hot")
            new_items = _fetch_sort(client, "new")
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] reddit fetch failed: {exc}")

    fetched_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    payload = {
        "fetched_at": fetched_iso,
        "subreddit": SUBREDDIT,
        "note": (
            f"Mirrors r/{SUBREDDIT} hot + new via Reddit JSON. Refreshed each ingest run; "
            "open subreddit for live view."
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
