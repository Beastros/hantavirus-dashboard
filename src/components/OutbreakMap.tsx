import { useMemo, useCallback, useState, useEffect } from 'react'
import type { MapLayerMouseEvent, Map as MapboxMap } from 'mapbox-gl'
import Map, { Layer, Popup, Source } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { RegionCase } from '../types'
import type { ShipTrackPoint } from '../loadData'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const STYLE  = 'mapbox://styles/mapbox/dark-v11'

interface ICase {
  id: string
  lat?: number | null; lng?: number | null
  origin_lat?: number | null; origin_lng?: number | null
  cluster_id?: string | null
  exposure_event?: string | null
  nationality?: string | null; age?: number | null; sex?: string | null
  location?: string | null; onset_date?: string | null
  outcome?: string | null; notes?: string | null
}

type ShipPosition = { lat: number; lng: number; name?: string; course?: number | null }

type Props = {
  regions: RegionCase[]
  individualCases: ICase[]
  shipPosition?: ShipPosition | null
  /** Ingest-maintained chronological fixes (`ship-track.json`); fallback polyline if missing/short. */
  shipTrackPoints?: ShipTrackPoint[] | null
  onSelect: (id: string | null) => void
  
}

const SHIP_ICON_ID = 'mv-ship-icon'

/** Ledger region row → Mapbox country-boundaries ISO α-3 */
const REGION_ID_ISO: Record<string, string> = {
  'ar-ushuaia': 'ARG',
  'sh-saint-helena': 'SHN',
  'sh-ascension': 'SHN',
  'cv-cape-verde': 'CPV',
  'za-johannesburg': 'ZAF',
  'nl-netherlands': 'NLD',
  'ch-zurich': 'CHE',
  'fr-france': 'FRA',
  'sg-singapore': 'SGP',
  'us-arizona': 'USA',
  'us-georgia': 'USA',
  'us-california': 'USA',
  'us-omaha': 'USA',
  'es-tenerife': 'ESP',
  'uk-london': 'GBR',
  'uk-tristan': 'SHN',
  'ca-canada': 'CAN',
  'uy-uruguay': 'URY',
  'cl-chile': 'CHL',
}

const USHUAIA_LNG_LAT: [number, number] = [-68.3030, -54.8019]
const SAINT_HELENA_LNG_LAT: [number, number] = [-5.7180, -15.9247]
const ASCENSION_LNG_LAT: [number, number] = [-14.3733, -7.9467]
const CAPE_VERDE_LNG_LAT: [number, number] = [-23.5133, 14.9330]
const TENERIFE_LNG_LAT: [number, number] = [-16.6291, 28.2916]

/**
 * Fallback voyage polyline when `ship-track.json` is absent or has too few points (densified port chain).
 */
const MV_ROUTE_PORTS: [number, number][] = [
  USHUAIA_LNG_LAT,
  [-61.2, -51.4],
  [-49.0, -45.5],
  [-38.0, -40.0],
  [-28.0, -34.0],
  [-18.5, -28.0],
  [-12.0, -22.0],
  SAINT_HELENA_LNG_LAT,
  ASCENSION_LNG_LAT,
  CAPE_VERDE_LNG_LAT,
  TENERIFE_LNG_LAT,
]

const EMPTY_GEO = { type: 'FeatureCollection' as const, features: [] as any[] }

function dedupeLngLat(seq: [number, number][], epsDeg = 0.04): [number, number][] {
  const out: [number, number][] = []
  for (const p of seq) {
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > epsDeg) out.push(p)
  }
  return out
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function densifyPortChain(ports: [number, number][], stepsPerLeg: number): [number, number][] {
  if (ports.length < 2) return [...ports]
  const out: [number, number][] = []
  for (let i = 0; i < ports.length - 1; i++) {
    const [lng0, lat0] = ports[i]
    const [lng1, lat1] = ports[i + 1]
    const n = Math.max(1, stepsPerLeg)
    for (let s = 0; s < n; s++) {
      const t = s / n
      out.push([lerp(lng0, lng1, t), lerp(lat0, lat1, t)])
    }
  }
  out.push(ports[ports.length - 1])
  return dedupeLngLat(out, 0.002)
}

const FALLBACK_NOMINAL_ROUTE = densifyPortChain(MV_ROUTE_PORTS, 32)

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function densifySingleLeg(a: [number, number], b: [number, number], steps: number): [number, number][] {
  const n = Math.max(1, steps)
  const out: [number, number][] = []
  for (let s = 0; s < n; s++) {
    const t = s / n
    out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)])
  }
  out.push(b)
  return out
}

function extendNominalToTenerife(coords: [number, number][], thresholdKm = 88): [number, number][] {
  if (coords.length < 1) return coords
  const last = coords[coords.length - 1]
  const d = haversineKm(last[1], last[0], TENERIFE_LNG_LAT[1], TENERIFE_LNG_LAT[0])
  if (d < thresholdKm) return dedupeLngLat(coords, 0.002)
  const tail = densifySingleLeg(last, TENERIFE_LNG_LAT, 28)
  const skipFirst =
    tail.length > 0 && Math.hypot(tail[0][0] - last[0], tail[0][1] - last[1]) < 1e-6 ? 1 : 0
  return dedupeLngLat([...coords, ...tail.slice(skipFirst)], 0.002)
}

function lngLatChainFromTrack(points: ShipTrackPoint[]): [number, number][] {
  const valid = points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const sorted = [...valid].sort((a, b) => (a.t ?? '').localeCompare(b.t ?? ''))
  const coords = sorted.map(p => [p.lng, p.lat] as [number, number])
  return dedupeLngLat(coords, 0.0008)
}

function buildNominalRouteFromIngest(trackPoints: ShipTrackPoint[] | null | undefined): [number, number][] {
  if (!trackPoints || trackPoints.length < 2) return FALLBACK_NOMINAL_ROUTE
  const base = lngLatChainFromTrack(trackPoints)
  if (base.length < 2) return FALLBACK_NOMINAL_ROUTE
  return extendNominalToTenerife(base)
}

function distSqLngLat(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function closestPointOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const ax = a[0], ay = a[1]
  const bx = b[0], by = b[1]
  const px = p[0], py = p[1]
  const abx = bx - ax, aby = by - ay
  const apx = px - ax, apy = py - ay
  const ab2 = abx * abx + aby * aby
  let t = ab2 > 1e-18 ? (apx * abx + apy * aby) / ab2 : 0
  t = Math.max(0, Math.min(1, t))
  return [ax + t * abx, ay + t * aby]
}

function closestOnPolyline(p: [number, number], poly: [number, number][]): { segIdx: number; q: [number, number] } {
  let bestI = 0
  let bestQ: [number, number] = poly[0]
  let bestD = Infinity
  for (let i = 0; i < poly.length - 1; i++) {
    const q = closestPointOnSegment(p, poly[i], poly[i + 1])
    const d = distSqLngLat(p, q)
    if (d < bestD) {
      bestD = d
      bestI = i
      bestQ = q
    }
  }
  return { segIdx: bestI, q: bestQ }
}

function pastPathOnNominal(nominal: [number, number][], segIdx: number, q: [number, number]): [number, number][] {
  const out: [number, number][] = []
  for (let j = 0; j <= segIdx; j++) out.push(nominal[j])
  const last = out[out.length - 1]
  if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-4) out.push(q)
  return out
}

function forwardPathOnNominal(nominal: [number, number][], segIdx: number, q: [number, number]): [number, number][] {
  const out: [number, number][] = [q]
  const eps = 1e-4
  for (let j = segIdx + 1; j < nominal.length; j++) {
    const v = nominal[j]
    const last = out[out.length - 1]
    if (Math.hypot(v[0] - last[0], v[1] - last[1]) > eps) out.push(v)
  }
  return out
}

function lineStringFC(coords: [number, number][]) {
  if (coords.length < 2) return EMPTY_GEO
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: coords },
    }],
  }
}

function bearingDegrees(from: { lng: number; lat: number }, to: { lng: number; lat: number }) {
  const φ1 = (from.lat * Math.PI) / 180
  const φ2 = (to.lat * Math.PI) / 180
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = (Math.atan2(y, x) * 180) / Math.PI
  return (θ + 360) % 360
}

function shipSymbolGeo(
  ship: ShipPosition,
  projectedCoords: [number, number][],
  nominalRoute: [number, number][],
) {
  if (!Number.isFinite(ship.lat) || !Number.isFinite(ship.lng)) return EMPTY_GEO
  let bearing: number
  if (projectedCoords.length >= 2) {
    const next = projectedCoords[1]
    bearing = bearingDegrees({ lng: ship.lng, lat: ship.lat }, { lng: next[0], lat: next[1] })
  } else if (typeof ship.course === 'number' && Number.isFinite(ship.course)) {
    bearing = ((ship.course % 360) + 360) % 360
  } else if (nominalRoute.length >= 2) {
    const prev = nominalRoute[nominalRoute.length - 2]
    const end = nominalRoute[nominalRoute.length - 1]
    bearing = bearingDegrees({ lng: prev[0], lat: prev[1] }, { lng: end[0], lat: end[1] })
  } else {
    bearing = 0
  }
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: { name: ship.name ?? 'MV Hondius', bearing },
      geometry: { type: 'Point' as const, coordinates: [ship.lng, ship.lat] },
    }],
  }
}

function buildShipTracks(
  ship: ShipPosition | null | undefined,
  nominal: [number, number][],
) {
  if (!ship || !Number.isFinite(ship.lat) || !Number.isFinite(ship.lng)) {
    return {
      solid: lineStringFC(nominal),
      projected: EMPTY_GEO,
      symbol: EMPTY_GEO,
    }
  }
  const p: [number, number] = [ship.lng, ship.lat]
  const { segIdx, q } = closestOnPolyline(p, nominal)
  const pastOnNominal = pastPathOnNominal(nominal, segIdx, q)
  const solidCoords =
    distSqLngLat(p, q) < 1e-8
      ? pastOnNominal
      : [...pastOnNominal, p]
  const forwardNominal = forwardPathOnNominal(nominal, segIdx, q)
  const projectedCoords: [number, number][] =
    forwardNominal.length >= 2 ? dedupeLngLat([p, ...forwardNominal.slice(1)], 0.002) : []

  const projectedFC = projectedCoords.length >= 2 ? lineStringFC(projectedCoords) : EMPTY_GEO

  return {
    solid: lineStringFC(solidCoords),
    projected: projectedFC,
    symbol: shipSymbolGeo(ship, projectedCoords, nominal),
  }
}

/** Minimal SVG frigate silhouette; drawn pointing north — Mapbox rotates by bearing. */
const SHIP_ICON_DATA_URL =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
      <path fill="#7EC8FF" stroke="#050608" stroke-width="2" stroke-linejoin="round"
        d="M36 10 L52 58 L36 48 L20 58 Z M31 48 L36 38 L41 48"/>
    </svg>`,
  )

function ledgerImpact(r: RegionCase): number {
  return (r.confirmed ?? 0) + (r.probable ?? 0) + (r.deaths ?? 0)
}

function hotspotIsoCodes(regions: RegionCase[]): string[] {
  const s = new globalThis.Set<string>()
  for (const row of regions) {
    if (ledgerImpact(row) < 1) continue
    const iso = REGION_ID_ISO[row.id]
    if (iso) s.add(iso)
  }
  return [...s]
}

const COLORS: Record<string, string> = {
  died: '#8B0000', confirmed: '#FF4444',
  hospitalized: '#FFB800', suspected: '#5A6B7A',   recovered: '#00C853',
}

const CLUSTER_ORIGIN_META: Record<string, { headline: string; place: string; detail: string }> = {
  'argentina-2026': {
    headline: 'INDEX EXPOSURE ORIGIN',
    place: 'Ushuaia corridor, Argentina',
    detail:
      'WHO ties the voyage timeline to MV Hondius departure after the Antarctic leg (Apr 1). This coordinate marks the cluster anchor used for traceback lines—the earliest documented pivot before onward travel and secondary clusters.',
  },
  'hondius-ship': {
    headline: 'SHIP CLUSTER ANCHOR',
    place: 'Cape Verde anchorage (Praia)',
    detail:
      'Anchorage window tied to multiple laboratory-confirmed infections and an onboard death; CDC/WHO treat this offshore stop as the dominant ship-phase exposure anchor for the Cape Verde cohort.',
  },
  'jnb-flight-apr25': {
    headline: 'FLIGHT CONTACT ANCHOR',
    place: 'Johannesburg (Airlink 25 Apr)',
    detail:
      'Contact-tracing centroid for passengers who shared the Saint Helena → Johannesburg leg with confirmed cases; used as the shared origin for rumor/surveillance pings—not a biological point source.',
  },
  'tristan-visit': {
    headline: 'TRISTAN VISIT ANCHOR',
    place: 'Tristan da Cunha',
    detail:
      'Isolated settlement spillover signal: suspected exposure linked to shore visits during the outbreak window. Coordinate mirrors the island centroid used for cluster traceback.',
  },
}

function clusterOriginMeta(clusterId: string | null | undefined, exposureFallback: string) {
  const id = clusterId ?? ''
  if (id && CLUSTER_ORIGIN_META[id]) return CLUSTER_ORIGIN_META[id]
  return {
    headline: 'EXPOSURE ANCHOR',
    place: id || 'Unknown cluster',
    detail: exposureFallback || 'Shared exposure coordinates for traceback grouping.',
  }
}

function caseGeo(cases: ICase[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cases
      .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
      .map(c => ({
        type: 'Feature' as const,
        properties: { id: c.id, color: COLORS[c.outcome ?? 'suspected'] ?? '#5A6B7A' },
        geometry: { type: 'Point' as const, coordinates: [c.lng as number, c.lat as number] },
      })),
  }
}

function lineGeo(selected: ICase, all: ICase[], bold: boolean) {
  const cluster = all.filter(c =>
    c.cluster_id === selected.cluster_id &&
    typeof c.lat === 'number' && typeof c.lng === 'number' &&
    typeof c.origin_lat === 'number' && typeof c.origin_lng === 'number'
  )
  const targets = bold ? cluster.filter(c => c.id === selected.id) : cluster.filter(c => c.id !== selected.id)
  return {
    type: 'FeatureCollection' as const,
    features: targets.map(c => ({
      type: 'Feature' as const, properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [[c.origin_lng as number, c.origin_lat as number], [c.lng as number, c.lat as number]],
      },
    })),
  }
}

function originGeo(selected: ICase, all: ICase[]) {
  const c = all.find(x => x.cluster_id === selected.cluster_id && typeof x.origin_lat === 'number')
  if (!c) return EMPTY_GEO
  const meta = clusterOriginMeta(c.cluster_id, c.exposure_event ?? '')
  const kind = c.cluster_id === 'argentina-2026' ? 'index' : 'chain'
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: {
        popup_kind: 'origin',
        kind,
        cluster_id: c.cluster_id ?? '',
        headline: meta.headline,
        place: meta.place,
        detail: meta.detail,
        eventLine: c.exposure_event ?? '',
      },
      geometry: { type: 'Point' as const, coordinates: [c.origin_lng as number, c.origin_lat as number] },
    }],
  }
}

/** One pin per cluster — highlights argentina-2026 (Ushuaia index voyage). */
function fixedOriginPins(cases: ICase[]) {
  const byCluster = new globalThis.Map<string, ICase>()
  for (const c of cases) {
    const cid = c.cluster_id
    if (!cid || typeof c.origin_lat !== 'number' || typeof c.origin_lng !== 'number') continue
    if (!byCluster.has(cid)) byCluster.set(cid, c)
  }
  const features = [...byCluster.values()].map((c) => {
    const kind = c.cluster_id === 'argentina-2026' ? 'index' : 'chain'
    const meta = clusterOriginMeta(c.cluster_id, c.exposure_event ?? '')
    return {
      type: 'Feature' as const,
      properties: {
        popup_kind: 'origin',
        kind,
        cluster_id: c.cluster_id ?? '',
        headline: meta.headline,
        place: meta.place,
        detail: meta.detail,
        eventLine: c.exposure_event ?? '',
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [c.origin_lng as number, c.origin_lat as number],
      },
    }
  })
  return { type: 'FeatureCollection' as const, features }
}

function estRt(regions: RegionCase[]) {
  const conf = regions.reduce((s, r) => s + (r.confirmed ?? 0), 0)
  const susp = regions.reduce((s, r) => s + (r.suspected ?? 0), 0)
  const dead = regions.reduce((s, r) => s + ((r as any).deaths ?? 0), 0)
  const tot  = conf + susp
  const b = { low: 1.2, mid: 1.6, high: 2.1 }, k = tot > 5 ? 0.55 : 0.7
  return {
    lo: (b.low*k).toFixed(2), mid: (b.mid*k).toFixed(2), hi: (b.high*k).toFixed(2), b,
    cfr: tot > 0 ? ((dead/tot)*100).toFixed(0) : '~35',
  }
}

export function OutbreakMap({
  regions,
  individualCases,
  shipPosition = null,
  shipTrackPoints = null,
  onSelect,
}: Props) {
  const rt = useMemo(() => estRt(regions), [regions])
  const [sel, setSel]     = useState<ICase | null>(null)
  const [popup, setPopup] = useState<{lng:number;lat:number;node:React.ReactNode}|null>(null)
  const [mapInst, setMapInst] = useState<MapboxMap | null>(null)
  const [shipIconReady, setShipIconReady] = useState(false)

  const dots       = useMemo(() => caseGeo(individualCases), [individualCases])
  const fixedPins  = useMemo(() => fixedOriginPins(individualCases), [individualCases])
  const isoHotspots = useMemo(() => hotspotIsoCodes(regions), [regions])
  const nominalRoute = useMemo(
    () => buildNominalRouteFromIngest(shipTrackPoints),
    [shipTrackPoints],
  )
  const { solid: shipSolidTrack, projected: shipProjectedTrack, symbol: shipSymbolGeojson } = useMemo(
    () => buildShipTracks(shipPosition, nominalRoute),
    [shipPosition, nominalRoute],
  )
  const showShipDot = !!(shipPosition && Number.isFinite(shipPosition.lat) && Number.isFinite(shipPosition.lng))
  const showShipProjected = shipProjectedTrack.features.length > 0
  const showShipSymbol = showShipDot && shipIconReady && shipSymbolGeojson.features.length > 0
  const boldLines  = useMemo(() => sel ? lineGeo(sel, individualCases, true)  : EMPTY_GEO, [sel, individualCases])
  const fadedLines = useMemo(() => sel ? lineGeo(sel, individualCases, false) : EMPTY_GEO, [sel, individualCases])
  const origin     = useMemo(() => sel ? originGeo(sel, individualCases) : EMPTY_GEO, [sel, individualCases])

  useEffect(() => {
    if (!mapInst) return
    let frame = 0
    const pulse = () => {
      frame = requestAnimationFrame(pulse)
      if (!mapInst.isStyleLoaded()) return
      const t = performance.now() / 1000
      const wave = 0.5 + 0.5 * Math.sin(t * 2.05)
      const waveSlow = 0.5 + 0.5 * Math.sin(t * 1.35)
      try {
        mapInst.setPaintProperty('case-pulse', 'circle-stroke-opacity', 0.12 + wave * 0.58)
        mapInst.setPaintProperty('case-pulse', 'circle-opacity', waveSlow * 0.32)
        mapInst.setPaintProperty('case-pulse', 'circle-radius', [
          'interpolate', ['linear'], ['zoom'],
          1, 10 + wave * 14,
          4, 22 + wave * 26,
        ])
        mapInst.setPaintProperty('fixed-index-halo', 'circle-radius', 16 + waveSlow * 18)
        mapInst.setPaintProperty('fixed-index-halo', 'circle-stroke-opacity', 0.18 + waveSlow * 0.62)
        mapInst.setPaintProperty('fixed-index-halo', 'circle-opacity', waveSlow * 0.22)
      } catch {
        /* layers not mounted yet */
      }
    }
    frame = requestAnimationFrame(pulse)
    return () => cancelAnimationFrame(frame)
  }, [mapInst])

  useEffect(() => {
    if (!mapInst) return
    if (mapInst.hasImage(SHIP_ICON_ID)) {
      setShipIconReady(true)
      return
    }
    const img = new Image(72, 72)
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        if (!mapInst.hasImage(SHIP_ICON_ID)) mapInst.addImage(SHIP_ICON_ID, img)
        setShipIconReady(true)
      } catch {
        setShipIconReady(false)
      }
    }
    img.onerror = () => setShipIconReady(false)
    img.src = SHIP_ICON_DATA_URL
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [mapInst])

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f) { setSel(null); setPopup(null); onSelect(null); return }

    const layerId = (f as { layer?: { id?: string } }).layer?.id ?? ''
    const props = f.properties as Record<string, string | undefined> | undefined

    const originLayers = new Set([
      'fixed-origin-dot', 'fixed-origin-ring', 'fixed-index-halo',
      'origin-dot', 'origin-ring',
    ])
    const isOriginPin = props?.popup_kind === 'origin' || originLayers.has(layerId)

    const coords =
      f.geometry?.type === 'Point'
        ? (f.geometry.coordinates as [number, number])
        : null

    if (isOriginPin && coords) {
      setSel(null)
      onSelect(null)
      const headline = props?.headline ?? 'EXPOSURE ANCHOR'
      const place = props?.place ?? 'Origin'
      const detail = props?.detail ?? ''
      const eventLine = props?.eventLine ?? props?.label ?? ''
      const isIndex = props?.kind === 'index'
      setPopup({
        lng: coords[0],
        lat: coords[1],
        node: (
          <div className="map-popup map-popup--origin">
            <div className={`mp-origin-tag${isIndex ? ' mp-origin-tag--index' : ''}`}>{headline}</div>
            <div className="mp-name">{place}</div>
            {props?.cluster_id && (
              <div className="mp-date">CLUSTER: {props.cluster_id}</div>
            )}
            <div className="mp-notes">{detail}</div>
            {eventLine && (
              <div className="mp-date" style={{ color: '#ffcf66', marginTop: 6 }}>
                EVENT: {eventLine}
              </div>
            )}
          </div>
        ),
      })
      return
    }

    const found = individualCases.find(c => c.id === props?.id)
    if (!found || typeof found.lat !== 'number') return
    setSel(found)
    onSelect(found.id)
    setPopup({
      lng: found.lng as number,
      lat: found.lat as number,
      node: (
        <div className="map-popup">
          <div className="mp-name">{found.location ?? 'Unknown'}</div>
          <div className="mp-level" style={{color: COLORS[found.outcome ?? 'suspected']}}>
            {(found.outcome ?? 'unknown').toUpperCase()}
          </div>
          <div className="mp-stats">
            {found.nationality && <span>{found.nationality}</span>}
            {found.age != null && <span> Age {found.age}</span>}
            {found.sex && <span> {found.sex}</span>}
          </div>
          {found.onset_date && <div className="mp-date">ONSET: {found.onset_date}</div>}
          {found.exposure_event && (
            <div className="mp-date" style={{color:'#ffcf66',marginTop:4}}>
              EXPOSURE: {found.exposure_event}
            </div>
          )}
          {found.notes && <div className="mp-notes">{found.notes}</div>}
        </div>
      ),
    })
  }, [individualCases, onSelect])

  const clear = useCallback(() => { setSel(null); setPopup(null); onSelect(null) }, [onSelect])

  const rtCol = parseFloat(rt.mid) > 1 ? '#FFB800' : '#00FF41'
  const rtLbl = parseFloat(rt.mid) > 1.5 ? 'GROWING' : parseFloat(rt.mid) > 1 ? 'SLOWING' : 'CONTROLLED'

  return (
    <div style={{position:'relative', width:'100%', height:'100%'}}>
      <Map mapboxAccessToken={TOKEN}
        initialViewState={{ longitude: -20, latitude: 15, zoom: 1.6 }}
        mapStyle={STYLE}
        interactiveLayerIds={[
          'case-dots',
          'fixed-origin-dot', 'fixed-origin-ring', 'fixed-index-halo',
          'origin-dot', 'origin-ring',
        ]}
        onLoad={(e) => {
          const m = e.target
          setMapInst(m)
          m.setProjection('globe')
          m.setFog({
            range: [-0.5, 10],
            color: '#060809',
            'high-color': '#080b10',
            'horizon-blend': 0.004,
            'space-color': '#050607',
            'star-intensity': 0.38,
          })
        }}
        onClick={onClick}
        style={{ width:'100%', height:'100%' }}
        dragRotate={true}
      >
        {isoHotspots.length > 0 && (
          <Source id="country-boundaries-src" type="vector" url="mapbox://mapbox.country-boundaries-v1">
            <Layer
              id="country-hot-fill"
              type="fill"
              source-layer="country_boundaries"
              filter={[
                'all',
                ['match', ['get', 'worldview'], ['all', 'US'], true, false],
                ['==', ['get', 'disputed'], false],
                ['in', ['get', 'iso_3166_1_alpha_3'], ['literal', isoHotspots]],
              ]}
              paint={{
                'fill-color': '#FF5533',
                'fill-opacity': 0.06,
              }}
            />
            <Layer
              id="country-hot-line"
              type="line"
              source-layer="country_boundaries"
              filter={[
                'all',
                ['match', ['get', 'worldview'], ['all', 'US'], true, false],
                ['==', ['get', 'disputed'], false],
                ['in', ['get', 'iso_3166_1_alpha_3'], ['literal', isoHotspots]],
              ]}
              paint={{
                'line-color': '#FF7744',
                'line-width': 2,
                'line-opacity': 0.62,
              }}
            />
          </Source>
        )}
        <Source id="ship-route-solid-src" type="geojson" data={shipSolidTrack}>
          <Layer
            id="ship-route-solid-glow"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': '#3388FF',
              'line-width': 10,
              'line-opacity': 0.2,
              'line-blur': 2.5,
            }}
          />
          <Layer
            id="ship-route-solid-core"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': '#66BBFF',
              'line-width': 2.4,
              'line-opacity': 0.95,
            }}
          />
        </Source>
        {showShipProjected && (
          <Source id="ship-route-projected-src" type="geojson" data={shipProjectedTrack}>
            <Layer
              id="ship-route-projected-glow"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': '#99CCFF',
                'line-width': 8,
                'line-opacity': 0.12,
                'line-blur': 2,
              }}
            />
            <Layer
              id="ship-route-projected-core"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': '#B8DCFF',
                'line-width': 1.35,
                'line-opacity': 0.65,
                'line-dasharray': [0.6, 2.2],
              }}
            />
          </Source>
        )}
        {showShipSymbol && (
          <Source id="ship-symbol-src" type="geojson" data={shipSymbolGeojson}>
            <Layer
              id="ship-symbol-halo"
              type="circle"
              paint={{
                'circle-radius': 14,
                'circle-color': 'rgba(102,187,255,0.15)',
                'circle-stroke-width': 0,
              }}
            />
            <Layer
              id="ship-symbol-icon"
              type="symbol"
              layout={{
                'icon-image': SHIP_ICON_ID,
                'icon-size': 0.62,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-rotate': ['get', 'bearing'],
                'icon-rotation-alignment': 'map',
                'icon-pitch-alignment': 'map',
              }}
            />
          </Source>
        )}
        <Source id="faded-src" type="geojson" data={fadedLines}>
          <Layer id="faded-line" type="line" paint={{'line-color':'#FF8888','line-width':1,'line-opacity':0.3,'line-dasharray':[3,4]}} />
        </Source>
        <Source id="bold-src" type="geojson" data={boldLines}>
          <Layer id="bold-line" type="line" paint={{'line-color':'#FF4444','line-width':2.5,'line-opacity':0.9,'line-dasharray':[4,3]}} />
        </Source>
        <Source id="fixed-origin-src" type="geojson" data={fixedPins}>
          <Layer
            id="fixed-index-halo"
            type="circle"
            filter={['==', ['get', 'kind'], 'index']}
            paint={{
              'circle-radius': 18,
              'circle-color': '#FFB800',
              'circle-opacity': 0.14,
              'circle-stroke-color': '#FFB800',
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.45,
              'circle-blur': 0.35,
            }}
          />
          <Layer
            id="fixed-origin-ring"
            type="circle"
            paint={{
              'circle-radius': ['match', ['get', 'kind'], 'index', 11, 9],
              'circle-color': 'rgba(0,0,0,0)',
              'circle-stroke-color': ['match', ['get', 'kind'], 'index', '#FFB800', '#CC4444'],
              'circle-stroke-width': 2,
              'circle-stroke-opacity': ['match', ['get', 'kind'], 'index', 0.95, 0.75],
            }}
          />
          <Layer
            id="fixed-origin-dot"
            type="circle"
            paint={{
              'circle-radius': ['match', ['get', 'kind'], 'index', 5, 4],
              'circle-color': ['match', ['get', 'kind'], 'index', '#FFB800', '#FF4444'],
              'circle-opacity': 0.92,
              'circle-stroke-color': '#090C10',
              'circle-stroke-width': 1.2,
            }}
          />
        </Source>
        <Source id="origin-src" type="geojson" data={origin}>
          <Layer id="origin-ring" type="circle" paint={{'circle-radius':14,'circle-color':'rgba(0,0,0,0)','circle-stroke-color':'#FF0000','circle-stroke-width':2,'circle-stroke-opacity':0.7}} />
          <Layer id="origin-dot"  type="circle" paint={{'circle-radius':6,'circle-color':'#FF0000','circle-stroke-color':'#FFFFFF','circle-stroke-width':1.5}} />
        </Source>
        <Source id="cases-src" type="geojson" data={dots}>
          <Layer id="case-pulse" type="circle" paint={{
            'circle-radius':['interpolate',['linear'],['zoom'],1,12,4,20],
            'circle-color':['get','color'],'circle-opacity':0,
            'circle-stroke-color':['get','color'],'circle-stroke-width':1.5,
            'circle-stroke-opacity':['interpolate',['linear'],['zoom'],1,0.35,4,0.08],
          }} />
          <Layer id="case-dots" type="circle" paint={{
            'circle-radius':7,
            'circle-color':['get','color'],
            'circle-opacity':0.92,
            'circle-stroke-color':'#090C10',
            'circle-stroke-width':1.5,
          }} />
        </Source>
        {popup && (
          <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom" onClose={clear} closeOnClick={false} offset={12}>
            {popup.node}
          </Popup>
        )}
      </Map>

      <div className="map-legend">
        {Object.entries(COLORS).map(([k,v]) => (
          <span key={k}><span className="legend-dot" style={{background:v}} /> {k}</span>
        ))}
        <span className="legend-note">
          Solid blue = sailed path from ingest breadcrumbs (<code>ship-track.json</code>, plus AIS appends). Pale dashed = remainder along nominal route to Tenerife. Red tint = ledger countries with confirmed/probable/deaths.
        </span>
      </div>

      <div className="rt-panel" onClick={clear}>
        <div className="rt-header">
          <span className="rt-title">EST. RT</span>
          <span className="rt-status" style={{color:rtCol}}>{rtLbl}</span>
        </div>
        <div className="rt-value" style={{color:rtCol}}>{rt.mid}</div>
        <div className="rt-range">range {rt.lo}-{rt.hi}</div>
        <div className="rt-divider" />
        <div className="rt-row"><span>ANDES R0</span><span>{rt.b.low}-{rt.b.high}</span></div>
        <div className="rt-row"><span>EST. CFR</span><span>~{rt.cfr}%</span></div>
        <div className="rt-row"><span>GEN. TIME</span><span>14-18d</span></div>
        <div className="rt-note">Click to clear selection.</div>
      </div>
    </div>
  )
}





