import type { RedditIntelFile, RedditListingSlice, RedditPost } from '../types'
import { parsePublishedInstant, timeAgoFromTs } from '../rssDates'

function redditCreatedTs(p: RedditPost): number | null {
  const u = p.created_utc
  if (u == null || typeof u !== 'number' || Number.isNaN(u)) return null
  return u * 1000
}

function postTimeLabel(p: RedditPost): string {
  const ts = redditCreatedTs(p)
  if (ts == null) return '—'
  return timeAgoFromTs(ts)
}

function sliceHot(data: RedditIntelFile): RedditListingSlice {
  const sub = data.subreddit ?? 'hantavirus'
  return {
    feed_url:
      data.sources?.hot?.feed_url ??
      data.feed_url ??
      `https://www.reddit.com/r/${sub}/hot/`,
    items: data.sources?.hot?.items ?? data.items ?? [],
  }
}

function sliceNew(data: RedditIntelFile): RedditListingSlice {
  const sub = data.subreddit ?? 'hantavirus'
  return {
    feed_url:
      data.sources?.new?.feed_url ?? `https://www.reddit.com/r/${sub}/new/`,
    items: data.sources?.new?.items ?? [],
  }
}

function ListingColumn({
  label,
  badgeCls,
  slice,
}: {
  label: string
  badgeCls: string
  slice: RedditListingSlice
}) {
  const items = slice.items ?? []

  return (
    <div className="reddit-intel-col">
      <div className="reddit-intel-col-head">
        <span className="reddit-sort-tag">{label}</span>
        <a className="reddit-intel-open" href={slice.feed_url} target="_blank" rel="noopener noreferrer">
          open →
        </a>
      </div>
      <div className="reddit-intel-scroll">
        {items.length === 0 ? (
          <div className="reddit-intel-empty">No posts in snapshot.</div>
        ) : (
          items.map((p) => (
            <div key={p.id} className="intel-item">
              <div className="intel-item-meta">
                <span className={`source-badge ${badgeCls}`}>{label}</span>
                <span className="intel-time" title={String(p.created_utc ?? '')}>
                  {postTimeLabel(p)}
                </span>
              </div>
              <div className="intel-title">
                <a href={p.reddit_url} target="_blank" rel="noopener noreferrer">
                  {p.title}
                </a>
              </div>
              <div className="intel-summary">
                ↑ {p.score} · {p.num_comments} comments
                {p.link_flair_text ? ` · ${p.link_flair_text}` : ''}
              </div>
              <a className="intel-read" href={p.reddit_url} target="_blank" rel="noopener noreferrer">
                OPEN THREAD ON REDDIT &gt;
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function IntelFeed({ reddit }: { reddit: RedditIntelFile }) {
  const hot = sliceHot(reddit)
  const neu = sliceNew(reddit)
  const sub = (reddit.subreddit ?? 'hantavirus').toLowerCase()
  const hub = `https://www.reddit.com/r/${sub}/`

  const fetchedTs = parsePublishedInstant(reddit.fetched_at)
  const pulledLabel =
    fetchedTs != null && !Number.isNaN(fetchedTs) ? `Snapshot ${timeAgoFromTs(fetchedTs)}` : ''
  const fetchedDisplay =
    fetchedTs != null && !Number.isNaN(fetchedTs)
      ? new Date(fetchedTs).toLocaleString()
      : reddit.fetched_at

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="intel-feed-header">
        INTEL · R/{sub.toUpperCase()} · HOT + NEW
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--muted)',
            fontSize: '8px',
            textAlign: 'right',
            maxWidth: '58%',
          }}
          title={reddit.fetched_at}
        >
          {pulledLabel}
          {pulledLabel && <br />}
          <span style={{ opacity: 0.85 }}>{fetchedDisplay}</span>
        </span>
      </div>
      {reddit.note ? (
        <div className="reddit-intel-note">{reddit.note}</div>
      ) : null}
      <div className="reddit-intel-hub">
        <a href={hub} target="_blank" rel="noopener noreferrer">
          Live subreddit (scroll) → r/{sub}
        </a>
      </div>
      <div className="reddit-intel-grid">
        <ListingColumn label="HOT" badgeCls="badge-reddit-hot" slice={hot} />
        <ListingColumn label="NEW" badgeCls="badge-reddit-new" slice={neu} />
      </div>
    </div>
  )
}
