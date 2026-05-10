import type { RegionCase } from '../types'

type Level = 'ok' | 'watch' | 'alert'

type Row = {
  id: string
  label: string
  level: Level
  detail: string
  source: string
  href: string
}

/** Static mock rows — replace with ingest-driven `canary-status.json` later. */
const MOCK_ROWS: Row[] = [
  {
    id: 'who-don',
    label: 'WHO Disease Outbreak News',
    level: 'ok',
    detail: 'Same event ID; no new WHO Region with sustained transmission declared.',
    source: 'who.int / DON',
    href: 'https://www.who.int/emergencies/disease-outbreak-news',
  },
  {
    id: 'who-risk',
    label: 'WHO public risk framing',
    level: 'ok',
    detail: 'Language still “localized / low population risk” vs. general-population pandemic framing.',
    source: 'WHO statements',
    href: 'https://www.who.int/news',
  },
  {
    id: 'cdc-travel',
    label: 'CDC Travel Health Notice',
    level: 'watch',
    detail: 'Watch Level 1 — usual precautions for defined travel corridors (mock tier).',
    source: 'cdc.gov/travel',
    href: 'https://wwwnc.cdc.gov/travel/notices',
  },
  {
    id: 'ecdc',
    label: 'ECDC rapid communication',
    level: 'ok',
    detail: 'No EU-wide threat brief or joint notification spike in last 48h (mock).',
    source: 'ecdc.europa.eu',
    href: 'https://www.ecdc.europa.eu/en/news-events',
  },
  {
    id: 'ihr',
    label: 'IHR / State Party signals',
    level: 'watch',
    detail: 'Port & repatriation logistics elevated; formal IHR event count unchanged (mock).',
    source: 'WHO + MOH press',
    href: 'https://www.who.int/health-topics/international-health-regulations',
  },
  {
    id: 'attention',
    label: 'Public attention (search interest)',
    level: 'watch',
    detail: 'Trending queries up vs. 7d baseline — attention ≠ incidence (mock).',
    source: 'trends proxy',
    href: '#',
  },
]

function ledgerImpact(r: RegionCase): number {
  return (r.confirmed ?? 0) + (r.probable ?? 0) + (r.deaths ?? 0)
}

function LevelBadge({ level }: { level: Level }) {
  const cfg = {
    ok: { bg: 'rgba(0,200,83,.15)', border: 'rgba(0,200,83,.45)', fg: '#00C853', abbr: 'LOW' },
    watch: { bg: 'rgba(255,184,0,.12)', border: 'rgba(255,184,0,.45)', fg: '#FFB800', abbr: 'WATCH' },
    alert: { bg: 'rgba(255,68,68,.12)', border: 'rgba(255,68,68,.5)', fg: '#FF4444', abbr: 'ALERT' },
  }[level]
  return (
    <span
      className="canary-badge"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.fg,
      }}
    >
      {cfg.abbr}
    </span>
  )
}

type Props = {
  regions: RegionCase[]
}

export function CanaryPanel({ regions }: Props) {
  const ledgerHotspots = regions.filter(r => ledgerImpact(r) >= 1).length
  const ledgerRow: Row = {
    id: 'ledger',
    label: 'This desk — ledger footprint',
    level: ledgerHotspots >= 10 ? 'watch' : 'ok',
    detail: `${ledgerHotspots} regions with ≥1 confirmed, probable, or death in cases.json (live).`,
    source: 'public/data/cases.json',
    href: '#',
  }

  const rows = [...MOCK_ROWS.slice(0, 3), ledgerRow, ...MOCK_ROWS.slice(3)]

  return (
    <section className="canary-deck panel" aria-labelledby="canary-deck-title">
      <header className="canary-deck-head">
        <div>
          <h2 id="canary-deck-title">Global threat canaries</h2>
          <p className="panel-sub canary-deck-sub">
            Mock layout — official feeds + desk metrics. Wire to ingest for live scoring.
          </p>
        </div>
        <span className="canary-mock-pill">PREVIEW</span>
      </header>

      <div className="canary-grid" role="list">
        {rows.map((row) => (
          <article key={row.id} className="canary-row" role="listitem">
            <div className="canary-row-top">
              <LevelBadge level={row.level} />
              <h3 className="canary-label">{row.label}</h3>
            </div>
            <p className="canary-detail">{row.detail}</p>
            <a
              className="canary-source"
              href={row.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              // {row.source}
            </a>
          </article>
        ))}
      </div>

      <p className="canary-foot">
        Green = no escalation vs. prior baseline · Amber = watch / logistics or attention · Red = formal
        risk or geographic jump (mock thresholds). Andes hantavirus: sustained H2H chains outside close
        contact would be a rare red-tier signal if ever documented.
      </p>
    </section>
  )
}
