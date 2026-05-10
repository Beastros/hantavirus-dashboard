import { useEffect, useState } from 'react'
import { loadIngestStatus } from '../loadData'

interface Status {
  last_run: string
  sources_ok: number
  sources_failed: number
  news_count: number
  case_count: number
}

export function FreshnessBar() {
  const [status, setStatus] = useState<Status | null>(null)
  const [, setTick] = useState(0)
  const [, setSecond] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setSecond(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const load = () => loadIngestStatus().then(setStatus).catch(() => {})
    load()
    const id = setInterval(() => { load(); setTick(t => t + 1) }, 30_000)
    return () => clearInterval(id)
  }, [])

  if (!status) return null

  const lastRun = new Date(status.last_run)
  const now = new Date()
  const nowMs = now.getTime()
  const minsAgo = Math.floor((nowMs - lastRun.getTime()) / 60_000)

  // Seconds until next :00 / :15 / :30 / :45 UTC (GitHub ingest uses a fifteen-minute cron).
  const remSec =
    (now.getUTCMinutes() % 15) * 60 + now.getUTCSeconds() + now.getUTCMilliseconds() / 1000
  const secToNextUtcQuarter = Math.max(0, Math.round(15 * 60 - remSec))
  const minsToNext = Math.floor(secToNextUtcQuarter / 60)
  const secsRem = secToNextUtcQuarter % 60
  const countdownStr = minsToNext > 0
    ? `${minsToNext}m ${secsRem.toString().padStart(2, '0')}s`
    : `${secsRem}s`

  /** `ingest-status.json` is only rewritten when ingest runs; allow ~3 missed slots before warning. */
  const STALE_MINS = 45
  const stale = minsAgo > STALE_MINS

  return (
    <div
      className="freshness-bar"
      title="Green dot = ingest-status.json is fresh. Amber = last_run older than 45m (workflow may be failing or skipped). Countdown = next UTC quarter-hour (cron cadence), not a guarantee of new commits."
    >
      <span className={`fresh-dot ${stale ? 'fresh-warn' : 'fresh-ok'}`} />
      <span className="fresh-label">
        Next UTC ingest slot: <strong>{countdownStr}</strong>
      </span>
      <span className="fresh-sep">|</span>
      <span className="fresh-label">
        Last ingest: {minsAgo < 1 ? 'just now' : minsAgo > 60
          ? `${Math.floor(minsAgo/60)}h ${minsAgo%60}m ago`
          : `${minsAgo}m ago`}
        {stale && (
          <span className="fresh-warn-text">
            {' '}
            (ingest-status.json &gt;{STALE_MINS}m — check GitHub Actions)
          </span>
        )}
      </span>
      <span className="fresh-sep">|</span>
      <span className="fresh-label">
        {status.sources_ok} sources
        {status.sources_failed > 0 && <span className="fresh-warn-text"> | {status.sources_failed} failed</span>}
      </span>
      <span className="fresh-sep">|</span>
      <span className="fresh-label">{status.news_count} headlines | {status.case_count} cases</span>
    </div>
  )
}

