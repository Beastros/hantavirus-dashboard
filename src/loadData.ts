import type { CasesFile, NewsFile } from './types'

function basePath(): string {
  const base = import.meta.env.BASE_URL
  return base.endsWith('/') ? base : `${base}/`
}

async function fetchJson<T>(path: string): Promise<T> {
  const bust = path.includes('?') ? `&_=${Date.now()}` : `?_=${Date.now()}`
  const res = await fetch(`${path}${bust}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

export function loadCases(): Promise<CasesFile> {
  return fetchJson<CasesFile>(`${basePath()}data/cases.json`)
}
export function loadNews(): Promise<NewsFile> {
  return fetchJson<NewsFile>(`${basePath()}data/news.json`)
}
export function loadIndividualCases(): Promise<any> {
  return fetchJson<any>(`${basePath()}data/cases-individual.json`)
}
export function loadIngestStatus(): Promise<any> {
  return fetchJson<any>(`${basePath()}data/ingest-status.json`)
}
export function loadShipPosition(): Promise<any> {
  return fetchJson<any>(`${basePath()}data/ship-position.json`)
}

/** Chronological AIS / ingest breadcrumbs for the MV Hondius map (`public/data/ship-track.json`). */
export type ShipTrackPoint = {
  t?: string
  lat: number
  lng: number
  source?: string
  note?: string
}

export function loadShipTrack(): Promise<{ updated?: string; mmsi?: string; points: ShipTrackPoint[] }> {
  return fetchJson(`${basePath()}data/ship-track.json`)
}
export function loadTrends(): Promise<any> {
  return fetchJson<any>(`${basePath()}data/trends.json`)
}
