# Project document — hantavirus-dashboard

High-level **architecture**, **data flow**, and **extension points** for collaborators and AI agents working on new modules.

---

## Purpose

A **static** React (Vite) “signal desk” UI: **Mapbox** outbreak map, curated **region ledger**, **per-case** table/chart, **RSS-derived** news ticker/feed, and optional **AIS-adjacent** ship position + **breadcrumb track** for the MV Hondius narrative. Deployed to **GitHub Pages**; data refresh is mostly **GitHub Actions** (ingest) committing JSON under `public/data/`.

---

## Stack

| Layer | Choice |
|--------|--------|
| UI | React 18, TypeScript |
| Bundler | Vite 5 (`base` derived from `GITHUB_REPOSITORY` for Pages subpaths) |
| Map | `react-map-gl` + `mapbox-gl` v3, Mapbox raster/vector styles |
| Ingest | Python 3.12, `httpx`, `feedparser`, optional `anthropic`, optional `pytrends` |
| Hosting | GitHub Pages + OIDC deploy workflow |

---

## Repository layout

```
src/
  App.tsx              # Shell: loads cases/news/cases-individual/ship position + ship track; grid layout
  loadData.ts          # All fetchJson helpers; respects Vite base URL
  types.ts             # Shared TS types for cases/news
  components/
    OutbreakMap.tsx    # Mapbox map: cases, origins, country highlights, ship route/symbol
    …                  # IntelFeed, Ticker, panels, tables, charts
public/data/           # Committed JSON consumed by the SPA (ingest overwrites many of these)
ingest/
  run.py               # RSS, primary scrape + Claude, AIS snapshot, ship-track merge, trends, status
  sources.yaml         # RSS URLs + keywords
.github/workflows/
  pages.yml            # Build + deploy (needs VITE_MAPBOX_TOKEN secret)
  ingest.yml           # Scheduled ingest (15 min), commits data updates
```

---

## Data files (contract summary)

| File | Producer | Consumer | Notes |
|------|-----------|----------|--------|
| `cases.json` | Manual / your pipeline | `RegionList`, map country tint logic | Regions + counts + `sources` |
| `cases-individual.json` | Ingest (+ seeds in `run.py`) | Case table, map dots, traceback lines | Per-person rows with lat/lng, cluster_id, outcomes |
| `news.json` | Ingest | Ticker, `IntelFeed` | `fetched_at`, `items[]` |
| `ship-position.json` | Ingest when `AIS_API_KEY` set | `App` → `OutbreakMap` | Single latest fix + metadata |
| `ship-track.json` | Seeded + ingest appends | `App` → `OutbreakMap` | **`points[]`** with `t`, `lat`, `lng`; drives **nominal sailed polyline** on the map |
| `ingest-status.json` | Ingest | Optional diagnostics | Run metadata |
| `trends.json` | Ingest | Optional | Google Trends payload |
| `last-build.txt` | Ingest / Actions | Cache-bust / rebuild signal | Timestamp |

**Insight for new modules:** anything the browser loads must use **`loadData.ts`** (or the same `basePath()` pattern) so GitHub Pages subpath deployments resolve `/repo/data/...` correctly.

---

## Workflows

1. **Pages (`pages.yml`)** — On push to `main`: `npm ci` + `npm run build` with `GITHUB_REPOSITORY` and **`secrets.VITE_MAPBOX_TOKEN`**, upload `dist/`, deploy Pages.
2. **Ingest (`ingest.yml`)** — Cron **every 15 minutes** (and `workflow_dispatch`): `python ingest/run.py`, then commit `public/data/` if changed.

---

## Map module (for future map-related work)

- **Country fill:** Mapbox `mapbox.country-boundaries-v1` vector tileset; ISO α-3 codes derived from ledger regions via `REGION_ID_ISO` in `OutbreakMap.tsx`.
- **Ship visualization:**  
  - **Solid** line = path along nominal route from start to closest point on polyline to current position (+ short connector if off-polyline).  
  - **Dashed** line = remaining nominal route from ship toward **Tenerife**.  
  - **Nominal route** = `ship-track.json` points (time-ordered), densified/deduped, with optional synthetic tail to Tenerife; **fallback** if track is missing/short: densified port waypoint chain (Ushuaia → Atlantic → Saint Helena → Ascension → Cape Verde → Tenerife).
- **iOS / narrow layout:** See **`CODE_RULES.md`** — explicit `.map-col` height on small breakpoints; globe/fog disabled on WebKit mobile UAs.

---

## Extension ideas (other modules)

- **Alternative basemap:** Swap `STYLE` in `OutbreakMap.tsx` or branch on env; keep token contract the same.
- **More ingest outputs:** Add `public/data/<name>.json`, add `loadX()` in `loadData.ts`, extend `App` state + polling interval if needed.
- **Historical AIS:** Extend `ingest/run.py` to merge third-party track files into `ship-track.json` (preserve schema: root `points` array of `{t, lat, lng, ...}`).
- **Non-map pages:** Add Vite routes (`react-router`) only if product needs multi-page; today everything is one SPA.

---

## Related docs

- **`CODE_RULES.md`** — Agent-oriented rules, pitfalls (layout, Mapbox, ingest), and checklists.
- **`README.md`** — Quick start, local ingest commands, Pages setup summary.
