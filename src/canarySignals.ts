import type { CasesFile, NewsFile, NewsItem, RegionCase } from './types'
import { parsePublishedInstant } from './rssDates'

export type CanaryLevel = 'ok' | 'watch' | 'alert'

export type CanaryRow = {
  id: string
  label: string
  level: CanaryLevel
  detail: string
  source: string
  href: string
}

function ledgerImpact(r: RegionCase): number {
  return (r.confirmed ?? 0) + (r.probable ?? 0) + (r.deaths ?? 0)
}

function dataHref(base: string, file: string): string {
  const b = base.endsWith('/') ? base : `${base}/`
  return `${b}data/${file}`
}

function minsSince(iso: string): number {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 999999
  return Math.floor((Date.now() - t) / 60_000)
}

function ingestRow(ingestStatus: Record<string, unknown> | null, base: string): CanaryRow {
  if (!ingestStatus || typeof ingestStatus.last_run !== 'string') {
    return {
      id: 'ingest',
      label: 'Ingest pipeline',
      level: 'watch',
      detail: 'ingest-status.json missing or unreadable — GitHub Actions ingest may not have run on this deploy.',
      source: 'ingest-status.json',
      href: dataHref(base, 'ingest-status.json'),
    }
  }
  const mins = minsSince(ingestStatus.last_run)
  const ok = Number(ingestStatus.sources_ok) || 0
  const fail = Number(ingestStatus.sources_failed) || 0
  const newsCount = Number(ingestStatus.news_count) || 0
  const caseCount = Number(ingestStatus.case_count) || 0
  let level: CanaryLevel = 'ok'
  if (mins > 180 || fail >= 4) level = 'alert'
  else if (mins > 40 || fail >= 1) level = 'watch'
  const detail =
    `Last run ${mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`}. ` +
    `RSS sources ${ok} ok${fail ? `, ${fail} failed` : ''}. ` +
    `Merged store: ${newsCount} headlines, ${caseCount} case rows.`
  return {
    id: 'ingest',
    label: 'Ingest pipeline',
    level,
    detail,
    source: 'ingest-status.json',
    href: dataHref(base, 'ingest-status.json'),
  }
}

function newsBundleRow(news: NewsFile, base: string): CanaryRow {
  const mins = minsSince(news.fetched_at)
  const n = news.items?.length ?? 0
  const cutoff = Date.now() - 48 * 3600_000
  let recent = 0
  for (const it of news.items || []) {
    const ts = parsePublishedInstant(it.published_at)
    if (ts != null && ts >= cutoff) recent++
  }
  let level: CanaryLevel = 'ok'
  if (mins > 24 * 60) level = 'alert'
  else if (mins > 6 * 60 || n < 8) level = 'watch'
  const detail =
    `Bundle pulled ${mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`}. ` +
    `${n} headlines in merge; ~${recent} with story date in last 48h (RSS date fields are coarse).`
  return {
    id: 'news-bundle',
    label: 'Intel merge (news.json)',
    level,
    detail,
    source: 'news.json',
    href: dataHref(base, 'news.json'),
  }
}

function ledgerRow(regions: RegionCase[], casesUpdated: string, base: string): CanaryRow {
  const hot = regions.filter(r => ledgerImpact(r) >= 1).length
  const high = regions.filter(r => r.outbreak_level === 'high').length
  const elevated = regions.filter(r => r.outbreak_level === 'elevated').length
  let level: CanaryLevel = 'ok'
  if (high >= 8 || hot >= 14) level = 'alert'
  else if (high >= 5 || hot >= 9) level = 'watch'
  const ledgerMins = minsSince(casesUpdated)
  const staleLedger = ledgerMins > 7 * 24 * 60
  if (staleLedger && level === 'ok') level = 'watch'
  const detail =
    `${hot} regions with ≥1 confirmed+probable+death; ${high} at HIGH tier, ${elevated} elevated. ` +
    `cases.json updated field: ${casesUpdated.slice(0, 10)}${staleLedger ? ' (stale — hand-edit or ingest).' : '.'}`
  return {
    id: 'ledger',
    label: 'Regional ledger (cases.json)',
    level,
    detail,
    source: 'cases.json',
    href: dataHref(base, 'cases.json'),
  }
}

function registryRow(cases: unknown[], base: string): CanaryRow {
  const died = cases.filter((c: any) => c?.outcome === 'died').length
  const lab = cases.filter((c: any) => c?.outcome === 'confirmed' || c?.outcome === 'died').length
  const susp = cases.filter((c: any) => c?.outcome === 'suspected' || c?.outcome === 'hospitalized').length
  let level: CanaryLevel = 'ok'
  if (died >= 8 || lab >= 25) level = 'alert'
  else if (died >= 4 || susp >= 14) level = 'watch'
  return {
    id: 'registry',
    label: 'Individual case registry',
    level,
    detail: `${lab} lab-confirmed or fatal rows; ${died} deaths; ${susp} suspected/hospitalized (includes rumor pings).`,
    source: 'cases-individual.json',
    href: dataHref(base, 'cases-individual.json'),
  }
}

function whoFeedRow(items: NewsItem[]): CanaryRow {
  const who = items.filter(
    i => /who\.int/i.test(i.url) || /\bwho\b/i.test(i.source_name || ''),
  ).length
  const cdc = items.filter(i => /cdc\.gov/i.test(i.url)).length
  let level: CanaryLevel = 'ok'
  if (who === 0 && items.length > 5) level = 'watch'
  return {
    id: 'who-feed',
    label: 'Official handles in merged RSS',
    level,
    detail: `${who} items link who.int; ${cdc} link cdc.gov (keyword match on URL/source name).`,
    source: 'news.json',
    href: 'https://www.who.int/emergencies/disease-outbreak-news',
  }
}

function trendsRow(trends: unknown | null): CanaryRow {
  if (!trends || typeof trends !== 'object') {
    return {
      id: 'trends',
      label: 'Search interest (Google Trends)',
      level: 'watch',
      detail: 'trends.json not loaded.',
      source: 'trends.json',
      href: 'https://trends.google.com/trends/explore',
    }
  }
  const t = trends as Record<string, unknown>
  if (t.error) {
    return {
      id: 'trends',
      label: 'Search interest (Google Trends)',
      level: 'watch',
      detail: `Ingest error: ${String(t.error).slice(0, 120)}`,
      source: 'trends.json',
      href: 'https://trends.google.com/trends/explore',
    }
  }
  const series = t.timeseries
  const kws = (t.keywords as string[]) || ['hantavirus']
  const primary = kws[0] || 'hantavirus'
  if (!Array.isArray(series) || series.length < 4) {
    return {
      id: 'trends',
      label: 'Search interest (Google Trends)',
      level: 'ok',
      detail: 'No usable multi-day window (empty timeseries or ingest not configured).',
      source: 'trends.json',
      href: 'https://trends.google.com/trends/explore',
    }
  }
  const vals: number[] = []
  for (const row of series as Record<string, unknown>[]) {
    const v = row[primary]
    if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
  }
  if (vals.length < 4) {
    return {
      id: 'trends',
      label: 'Search interest (Google Trends)',
      level: 'ok',
      detail: `Series present but sparse for keyword “${primary}”.`,
      source: 'trends.json',
      href: 'https://trends.google.com/trends/explore',
    }
  }
  const last = vals[vals.length - 1]
  const prev = vals.slice(0, -1)
  const mean = prev.reduce((a, b) => a + b, 0) / prev.length
  const ratio = mean < 0.5 ? 1 : last / mean
  let level: CanaryLevel = 'ok'
  if (ratio >= 2.2 && last >= 40) level = 'alert'
  else if (ratio >= 1.45 && last >= 25) level = 'watch'
  return {
    id: 'trends',
    label: 'Search interest (Google Trends)',
    level,
    detail: `Keyword “${primary}”: latest=${last} vs prior-day mean≈${mean.toFixed(1)} (ratio ${ratio.toFixed(2)}). Public attention ≠ cases.`,
    source: 'trends.json',
    href: 'https://trends.google.com/trends/explore',
  }
}

export function buildCanaryRows(
  input: {
    cases: CasesFile
    news: NewsFile
    individualCases: unknown[]
    ingestStatus: Record<string, unknown> | null
    trends: unknown | null
  },
  baseUrl: string,
): CanaryRow[] {
  const { cases, news, individualCases, ingestStatus, trends } = input
  return [
    ingestRow(ingestStatus, baseUrl),
    newsBundleRow(news, baseUrl),
    ledgerRow(cases.regions, cases.updated, baseUrl),
    registryRow(individualCases, baseUrl),
    whoFeedRow(news.items || []),
    trendsRow(trends),
  ]
}
