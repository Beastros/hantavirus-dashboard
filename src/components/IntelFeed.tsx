interface NewsItem {
  id: string
  title: string
  url: string
  published_at?: string | null
  source_name: string
  summary?: string | null
}

const SOURCE_MAP: Record<string, { label: string; cls: string }> = {
  'who': { label: 'WHO', cls: 'badge-who' },
  'cdc': { label: 'CDC', cls: 'badge-cdc' },
  'reuters': { label: 'REUTERS', cls: 'badge-reuters' },
  'bbc': { label: 'BBC', cls: 'badge-bbc' },
  'stat': { label: 'STAT', cls: 'badge-stat' },
  'guardian': { label: 'GUARDIAN', cls: 'badge-guardian' },
  'cidrap': { label: 'CIDRAP', cls: 'badge-stat' },
  'nyt': { label: 'NYT', cls: 'badge-default' },
  'nejm': { label: 'NEJM', cls: 'badge-default' },
  'lancet': { label: 'LANCET', cls: 'badge-default' },
  'science': { label: 'SCIENCE', cls: 'badge-default' },
}

function getBadge(sourceName: string) {
  const key = Object.keys(SOURCE_MAP).find(k => sourceName.toLowerCase().includes(k))
  return key ? SOURCE_MAP[key] : { label: sourceName.split(' ')[0].toUpperCase(), cls: 'badge-default' }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Avoid "...Belgium, I..." mid-word cuts when clipping previews */
function clipPreview(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  const chunk = s.slice(0, maxLen)
  const sp = chunk.lastIndexOf(' ')
  const cut = sp > Math.floor(maxLen * 0.55) ? chunk.slice(0, sp) : chunk
  return cut.trimEnd() + '...'
}

/**
 * RSS often emits `published_at` as date-only (`YYYY-MM-DD`). Parsing that as ISO UTC midnight
 * makes every headline look "1d old" the next calendar day — use local noon for date-only strings.
 */
function parsePublishedInstant(dateStr?: string | null): number | null {
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

function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgoFromTs(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const h = Math.floor(diff / 3600000)
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

function articleTimeLabel(publishedAt?: string | null): string {
  const ts = parsePublishedInstant(publishedAt)
  if (ts == null) return '—'
  const rel = timeAgoFromTs(ts)
  const dateOnly = publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(publishedAt.trim())
  if (dateOnly) return `${rel} · ${formatShortDate(ts)}`
  return rel
}

export function IntelFeed({ items, fetchedAt }: { items: NewsItem[]; fetchedAt: string }) {
  const fetchedTs = parsePublishedInstant(fetchedAt)
  const pulledLabel =
    fetchedTs != null && !Number.isNaN(fetchedTs) ? `Pulled ${timeAgoFromTs(fetchedTs)}` : ''
  const fetchedDisplay =
    fetchedTs != null && !Number.isNaN(fetchedTs)
      ? new Date(fetchedTs).toLocaleString()
      : fetchedAt

  return (
    <div style={{height:'100%', display:'flex', flexDirection:'column'}}>
      <div className="intel-feed-header">
        INTEL FEED
        <span
          style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '8px', textAlign: 'right', maxWidth: '58%' }}
          title={fetchedAt}
        >
          {pulledLabel}
          {pulledLabel && <br />}
          <span style={{ opacity: 0.85 }}>{fetchedDisplay}</span>
        </span>
      </div>
      <div style={{overflowY:'auto', flex:1, scrollbarWidth:'thin', scrollbarColor:'var(--border2) transparent'}}>
        {items.map(item => {
          const badge = getBadge(item.source_name)
          const preview = item.summary ? stripHtml(item.summary) : ''
          return (
            <div key={item.id} className="intel-item">
              <div className="intel-item-meta">
                <span className={`source-badge ${badge.cls}`}>{badge.label}</span>
                <span className="intel-time" title={item.published_at ?? ''}>{articleTimeLabel(item.published_at)}</span>
              </div>
              <div className="intel-title">{stripHtml(item.title)}</div>
              {preview && (
                <div className="intel-summary">{clipPreview(preview, 120)}</div>
              )}
              <a className="intel-read" href={item.url} target="_blank" rel="noopener noreferrer">
                READ FULL ARTICLE &gt;
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}
