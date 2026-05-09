# Outbreak signals dashboard

Static React dashboard for **map + curated case ledger + RSS ingest**, built with Vite and deployed to **GitHub Pages** from Actions.

**Project overview & architecture:** [`PROJECT.md`](PROJECT.md)  
**Conventions, Mapbox/iOS pitfalls, ingest notes (for collaborators / AI):** [`CODE_RULES.md`](CODE_RULES.md)

---

## Prerequisites

- **Node.js** 18+ (CI uses 22)
- **Mapbox access token** for the map ([account.mapbox.com](https://account.mapbox.com/access-tokens/))

---

## Local development

From the repository root (folder name may differ after clone):

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
# Edit .env.local — set VITE_MAPBOX_TOKEN=pk.…
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/`).

Without `VITE_MAPBOX_TOKEN`, the rest of the UI still loads; the map area shows **MAP OFFLINE** with setup instructions.

## Production build

```bash
npm run build
npm run preview   # optional smoke test of dist/
```

`vite.config.ts` sets `base` to `/${repoName}/` when `GITHUB_REPOSITORY` is set in the environment (GitHub Actions). Locally, `base` is `/`.

---

## GitHub Pages (one-time repo settings)

1. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions** (not “Deploy from a branch”).
2. **Settings → Secrets and variables → Actions:** add repository secret **`VITE_MAPBOX_TOKEN`** (same value as local `.env.local`). The **GitHub Pages** workflow (`/.github/workflows/pages.yml`) injects it at build time; the build log prints `Token present: true/false` (boolean only, not the secret).
3. Push to `main`. Workflow **GitHub Pages** builds the repo root, uploads the **`dist/`** artifact, and deploys.
4. Open `https://<user>.github.io/<repository>/` (note trailing slash behavior is normal).

**Troubleshooting**

- **Blank map on live site:** missing or wrong `VITE_MAPBOX_TOKEN` secret → rebuild after fixing.
- **JSON or JS 404 under `/repo/...`:** `base` mismatch → confirm the Pages workflow passes `GITHUB_REPOSITORY` (it does by default via `${{ github.repository }}`).
- **Map OK on desktop but blank on iPhone:** see [`CODE_RULES.md`](CODE_RULES.md) (grid height + globe fallback).

---

## Data files (`public/data/`)

| File | Role |
|------|------|
| `cases.json` | Curated regions, counts, outbreak level, **primary source URLs**; includes `disclaimer`. |
| `cases-individual.json` | Per-case rows for table, map dots, traceback lines (ingest merges with seeds). |
| `news.json` | Ingest output: keyword-filtered headlines for ticker + intel feed. |
| `ship-position.json` | Latest AIS-style snapshot when ingest has `AIS_API_KEY` (optional). |
| `ship-track.json` | Time-ordered `{t, lat, lng, …}` breadcrumbs for the **nominal ship path** on the map (seeded + AIS appends). |
| `ingest-status.json`, `trends.json`, `last-build.txt` | Run metadata / optional features / rebuild stamp. |

More detail: [`PROJECT.md`](PROJECT.md).

---

## Ingest (Python)

Feeds and keywords: `ingest/sources.yaml`.

```bash
cd ingest
python -m venv .venv
# Windows: .venv\Scripts\activate   | macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

**Optional environment variables** (for full ingest behavior): `ANTHROPIC_API_KEY`, `AIS_API_KEY`. Without them, RSS and file writes still run where applicable.

GitHub runs **Ingest RSS + AI extraction** (`.github/workflows/ingest.yml`) on a **15-minute** schedule and on demand; it may commit updates under `public/data/`, which triggers a new Pages build.

Respect each feed site’s terms and robots policy when changing sources.

---

## Go-live checklist (stopping point)

- [ ] `npm run build` succeeds locally.
- [ ] `VITE_MAPBOX_TOKEN` in **Actions secrets**; Pages workflow green on `main`.
- [ ] Live URL: ticker + sidebars + **map** (pan/zoom); spot-check **mobile** width.
- [ ] `public/data/*.json` committed so first clone works without waiting for ingest.

---

## Honest use

Reporting for rare diseases is uneven. Treat the map as **“what we linked and counted under our rules”**, not a complete global surveillance picture. Keep `disclaimer` in `cases.json` accurate.
