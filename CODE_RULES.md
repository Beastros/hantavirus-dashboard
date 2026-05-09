# Code rules & agent notes (hantavirus-dashboard)

Conventions and **lessons learned** for anyone (human or AI) extending this repo. Prefer matching existing patterns over introducing new stacks or heavy refactors.

---

## General

- **Minimal diffs**: touch only files and symbols needed for the task. No drive-by renames, no unrelated formatting sweeps.
- **TypeScript**: run `npx tsc --noEmit` before committing map or data-contract changes.
- **Secrets**: never commit API keys. Mapbox uses `VITE_MAPBOX_TOKEN` (GitHub Actions secret for Pages). AIS uses `AIS_API_KEY` in the ingest workflow only.

---

## Frontend (Vite + React)

### Mapbox token

- **`VITE_MAPBOX_TOKEN`** must be set for the map to initialize. If it is missing or blank, `OutbreakMap` renders a **MAP OFFLINE** panel instead of a broken Mapbox canvas (clearer for local dev and misconfigured CI).
- Copy **`.env.example`** → **`.env.local`** for local tokens (gitignored).

### Asset URLs and `base`

- `vite.config.ts` sets `base` to `/${repoName}/` when `GITHUB_REPOSITORY` is set (GitHub Actions build). Locally it is `/`.
- All runtime JSON loads must go through **`loadData.ts`** helpers so paths respect `import.meta.env.BASE_URL` (see `basePath()` + `fetchJson` cache-busting). Do not hard-code `/data/...` at the site root.

### Layout and Mapbox on mobile / iOS

**Lesson:** On narrow breakpoints, `.main-grid` uses `height: auto`. The map container used `height: 100%`, which **collapsed to zero height** because the percentage had no definite containing block height. The map looked “broken” on iPhone even though desktop worked.

- **Rule:** Any column that wraps a Mapbox/`react-map-gl` canvas must have a **definite height** (e.g. `min-height` + `height` with `clamp` and `vh` on the `@media (max-width: 1100px)` `.map-col` rule in `src/index.css`). Re-check this if you change the main grid layout.

**Lesson:** Mapbox GL **globe** projection and **`setFog`** are still uneven on **iOS / iPadOS WebKit**.

- **Rule:** `OutbreakMap.tsx` uses `useGlobeProjectionPreferred()` to skip globe + fog on iPhone/iPod touch and iPad (including “desktop mode” iPad). New map features should assume **Mercator on those UA strings** unless you explicitly test globe on device.

### Map module (`OutbreakMap.tsx`)

- **Nominal sailed route** is built from **`public/data/ship-track.json`** (`ShipTrackPoint[]`, sorted by `t`), not from a single AIS snapshot. If there are fewer than two valid points, the UI falls back to a **densified port chain** (`MV_ROUTE_PORTS` / `FALLBACK_NOMINAL_ROUTE`).
- **Tail to Tenerife:** `extendNominalToTenerife` appends a densified leg to Tenerife when the last track point is still far (haversine threshold), so the dashed “remainder” line still reaches the declared destination when the JSON trail ends short of the island.
- **Solid vs dashed:** `buildShipTracks` snaps the live ship position to the closest point on the nominal polyline, draws **solid** path = past + optional connector to ship, **dashed** = ship → rest of nominal toward Tenerife.
- **Ship symbol:** SVG data-URL → `Image` → `map.addImage`. `icon-rotate` uses bearing toward the next projected vertex, else `course` from JSON, else final-leg bearing. If you change icon loading, retest **Safari** (CORS / tainted canvas rules are stricter than Chrome for some patterns; current code uses a data URL to avoid cross-origin images on the canvas).
- **Module initialization order:** `EMPTY_GEO` and `dedupeLngLat` must be defined **before** any helper that calls them at module load (e.g. route densification). Easy to break when reordering.

### Styling

- Global layout and map chrome live in **`src/index.css`**. Prefer extending existing variables (`--bg`, `--panel`, etc.) for new UI.

---

## Ingest (`ingest/run.py`)

- Writes under **`public/data/`** only. Paths use `ROOT.parent / "public" / "data"`.
- **`ship-position.json`**: single AIS snapshot when `AIS_API_KEY` is set (REST call as implemented).
- **`ship-track.json`**: **append-only breadcrumb list** merged each run via `merge_track_point`: skips duplicate points if the vessel has not moved much **and** the last fix was **under 15 minutes** ago; caps list length (3000). Preserves seeded narrative points when merging with live AIS.
- AISStream is **not** used for full historical polylines in one shot; the track file is the durable store. For richer history, bulk-edit `ship-track.json` or extend ingest (e.g. import GPX) — the frontend already consumes whatever points exist.

---

## Testing checklist for map / layout changes

1. `npx tsc --noEmit`
2. Desktop Chrome: map visible, globe OK if non-iOS UA.
3. Narrow viewport or real **iPhone Safari**: map column has height, tiles render, pan/zoom OK.
4. GitHub Pages URL (with repo subpath): JSON and map tiles load (token present in Actions).

---

## What not to do

- Do not put `VITE_MAPBOX_TOKEN` in client-side `.env` files committed to the repo.
- Do not assume `height: 100%` on the map works without an ancestor with explicit height in all breakpoints.
- Do not reorder `OutbreakMap.tsx` top-level constants without checking **temporal dead zone** / initialization order for helpers used at module scope.
