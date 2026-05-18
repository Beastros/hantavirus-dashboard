import type { CasesFile, NewsFile, RedditIntelFile } from './types'

const LIVE_DATA_REPO = 'Beastros/hantavirus-dashboard'
const LIVE_DATA_BRANCH = 'main'

function basePath(): string {
  const base = import.meta.env.BASE_URL
  return base.endsWith('/') ? base : `${base}/`
}

function isGithubPages(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname.endsWith('.github.io')
}

function dataJsonUrl(file: string): string {
  if (isGithubPages()) {
    return `https://cdn.jsdelivr.net/gh/${LIVE_DATA_REPO}@${LIVE_DATA_BRANCH}/public/data/${file}`
  }
  return `${basePath()}data/${file}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const bust = url.includes('?') ? `&_=${Date.now()}` : `?_=${Date.now()}`
  const res = await fetch(`${url}${bust}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return res.json() as Promise<T>
}

export function loadCases(): Promise<CasesFile> {
  return fetchJson<CasesFile>(dataJsonUrl('cases.json'))
}
export function loadNews(): Promise<NewsFile> {
  return fetchJson<NewsFile>(dataJsonUrl('news.json'))
}

export function loadRedditIntel(): Promise<RedditIntelFile> {
  return fetchJson<RedditIntelFile>(dataJsonUrl('reddit_hot.json'))
}
export function loadIndividualCases(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('cases-individual.json'))
}
export function loadIngestStatus(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('ingest-status.json'))
}
export function loadShipPosition(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('ship-position.json'))
}

export type ShipTrackPoint = {
  t?: string
  lat: number
  lng: number
  source?: string
  note?: string
}

export function loadShipTrack(): Promise<{ updated?: string; mmsi?: string; points: ShipTrackPoint[] }> {
  return fetchJson(dataJsonUrl('ship-track.json'))
}
export function loadTrends(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('trends.json'))
}
