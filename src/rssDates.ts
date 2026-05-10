/**
 * RSS often emits `published_at` as date-only (`YYYY-MM-DD`). Parsing that as ISO UTC midnight
 * skews "hours ago" — use local noon for date-only strings.
 */
export function parsePublishedInstant(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const s = dateStr.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2]) - 1
    const d = Number(m[3])
    return new Date(y, mo, d, 12, 0, 0, 0).getTime()
  }
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

export function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function timeAgoFromTs(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const h = Math.floor(diff / 3600000)
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}
