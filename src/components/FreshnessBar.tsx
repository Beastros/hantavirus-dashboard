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

  useEffect(() => {
    const load = () => loadIngestStatus().then(setStatus).catch(() => {})
    load()
    const id = setInterval(() => { load(); setTick(t => t + 1) }, 30_000)
    return () => clearInterval(id)
  }, [])

  if (!status) return null

  const lastRun = new Date(status.last_run)
  const now = new Date()
  const minsAgo = Math.floor((now.getTime() - lastRun.getTime()) / 60_000)

  const next = new Date(now)
  next.setSeconds(0, 0)
  const m = next.getMinutes()
  const nextM = Math.ceil((m + 1) / 15) * 15
  if (nextM >= 60) { next.setHours(next.getHours() + 1); next.setMinutes(0) }
  else next.setMinutes(nextM)
  const secsToNext = Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000))
  const minsToNext = Math.floor(secsToNext / 60)
  const secsRem = secsToNext % 60

  const stale = minsAgo > 20
  const countdownStr = minsToNext > 0
    ? `${minsToNext}m ${secsRem.toString().padStart(2,'0')}s`
    : `${secsRem}s`

  return (
    <div className="freshness-bar">
      <span className={`fresh-dot ${stale ? 'fresh-warn' : 'fresh-ok'}`} />
      <span className="fresh-label">
        Next update in: <strong>{countdownStr}</strong>
      </span>
      <span className="fresh-sep">|</span>
      <span className="fresh-label">
        Last ingest: {minsAgo < 1 ? 'just now' : minsAgo > 60
          ? `${Math.floor(minsAgo/60)}h ${minsAgo%60}m ago`
          : `${minsAgo}m ago`}
        {stale && <span className="fresh-warn-text"> (pending push to CI)</span>}
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
