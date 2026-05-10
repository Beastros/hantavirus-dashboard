import { useMemo } from 'react'
import type { CasesFile, NewsFile } from '../types'
import { buildCanaryRows, type CanaryLevel } from '../canarySignals'

function LevelBadge({ level }: { level: CanaryLevel }) {
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
  cases: CasesFile
  news: NewsFile
  individualCases: unknown[]
  ingestStatus: Record<string, unknown> | null
  trends: unknown | null
}

export function CanaryPanel({ cases, news, individualCases, ingestStatus, trends }: Props) {
  const base = import.meta.env.BASE_URL || '/'
  const rows = useMemo(
    () => buildCanaryRows({ cases, news, individualCases, ingestStatus, trends }, base),
    [cases, news, individualCases, ingestStatus, trends, base],
  )

  return (
    <section className="canary-deck panel" aria-labelledby="canary-deck-title">
      <header className="canary-deck-head">
        <div>
          <h2 id="canary-deck-title">Global threat canaries</h2>
          <p className="panel-sub canary-deck-sub">
            Live signals from the same JSON this page loads (ingest status, news merge, ledger, registry,
            Trends). Thresholds are heuristics — verify at primary sources before citing.
          </p>
        </div>
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
        LOW = within heuristic norms · WATCH = stale feeds, source failures, or elevated counts · ALERT =
        strong deviation (very stale ingest, many HIGH ledger rows, or search-interest spike). Andes
        hantavirus: sustained unrelated H2H chains would be a separate red flag not inferred here.
      </p>
    </section>
  )
}
