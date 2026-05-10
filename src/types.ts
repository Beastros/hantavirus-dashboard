export type OutbreakLevel = 'informational' | 'elevated' | 'high'

export interface RegionCase {
  id: string
  name: string
  lat: number
  lng: number
  suspected?: number
  probable?: number
  confirmed?: number
  deaths?: number
  ruled_out?: number
  outbreak_level?: OutbreakLevel
  last_reported?: string
  sources: string[]
}

export interface CasesFile {
  updated: string
  disclaimer: string
  regions: RegionCase[]
}

export interface NewsItem {
  id: string
  title: string
  url: string
  published_at: string | null
  source_name: string
  source_tier: number
  summary?: string
}

export interface NewsFile {
  fetched_at: string
  items: NewsItem[]
}

/** Reddit JSON mirror for the intel column (r/hantavirus hot + new). */
export interface RedditPost {
  id: string
  title: string
  reddit_url: string
  score: number
  num_comments: number
  created_utc?: number | null
  author?: string | null
  link_flair_text?: string | null
}

export interface RedditListingSlice {
  feed_url: string
  items: RedditPost[]
}

export interface RedditIntelFile {
  fetched_at: string
  subreddit: string
  note?: string
  sources: {
    hot: RedditListingSlice
    new: RedditListingSlice
  }
  /** Legacy single-list readers */
  feed_url?: string
  items?: RedditPost[]
}

export const EMPTY_REDDIT_INTEL: RedditIntelFile = {
  fetched_at: '1970-01-01T00:00:00+00:00',
  subreddit: 'hantavirus',
  note: 'Waiting for ingest to populate reddit_hot.json…',
  sources: {
    hot: {
      feed_url: 'https://www.reddit.com/r/hantavirus/hot/',
      items: [],
    },
    new: {
      feed_url: 'https://www.reddit.com/r/hantavirus/new/',
      items: [],
    },
  },
}
