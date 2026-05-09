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
}

function getBadge(sourceName: string) {
  const key = Object.keys(SOURCE_MAP).find(k => sourceName.toLowerCase().includes(k))
  return key ? SOURCE_MAP[key] : { label: sourceName.split(' ')[0].toUpperCase(), cls: 'badge-default' }
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h/24)}d ago`
}

export function IntelFeed({ items, fetchedAt }: { items: NewsItem[]; fetchedAt: string }) {
  return (
    <div style={{height:'100%', display:'flex', flexDirection:'column'}}>
      <div className="intel-feed-header">
        INTEL FEED
        <span style={{marginLeft:'auto', color:'var(--muted)', fontSize:'8px'}}>
          SYNC {new Date(fetchedAt).toUTCString().slice(17,22)} UTC
        </span>
      </div>
      <div style={{overflowY:'auto', flex:1, scrollbarWidth:'thin', scrollbarColor:'var(--border2) transparent'}}>
        {items.map(item => {
          const badge = getBadge(item.source_name)
          return (
            <div key={item.id} className="intel-item">
              <div className="intel-item-meta">
                <span className={`source-badge ${badge.cls}`}>{badge.label}</span>
                <span className="intel-time">{timeAgo(item.published_at)}</span>
              </div>
              <div className="intel-title">{item.title}</div>
              {item.summary && (
                <div className="intel-summary">{item.summary.slice(0, 120)}{item.summary.length > 120 ? '...' : ''}</div>
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
