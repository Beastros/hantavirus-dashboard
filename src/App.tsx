import { useEffect, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { OutbreakMap } from './components/OutbreakMap'
import { NewsColumn } from './components/NewsColumn'
import { RegionList } from './components/RegionList'
import { FreshnessBar } from './components/FreshnessBar'
import { CaseTable } from './components/CaseTable'
import { PivotChart } from './components/PivotChart'
import { loadCases, loadNews, loadIndividualCases } from './loadData'
import type { CasesFile, NewsFile } from './types'

export default function App() {
  const mapRef = useRef<MapRef>(null)
  const [cases, setCases] = useState<CasesFile | null>(null)
  const [news, setNews] = useState<NewsFile | null>(null)
  const [individualCases, setIndividualCases] = useState<any[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [c, n] = await Promise.all([loadCases(), loadNews()])
        if (!cancelled) { setCases(c); setNews(n) }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load data')
      }
    })()
    loadIndividualCases()
      .then((d: any) => { if (!cancelled) setIndividualCases(d.cases || []) })
      .catch(() => {})
    const refresh = setInterval(async () => {
      try {
        const [c, n] = await Promise.all([loadCases(), loadNews()])
        setCases(c); setNews(n)
      } catch {}
      loadIndividualCases().then((d: any) => setIndividualCases(d.cases || [])).catch(() => {})
    }, 15 * 60 * 1000)
    return () => { cancelled = true; clearInterval(refresh) }
  }, [])

  useEffect(() => {
    if (!selectedId || !cases) return
    const r = cases.regions.find((x) => x.id === selectedId)
    if (!r) return
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 5, duration: 900 })
  }, [selectedId, cases])

  if (err) return <div className="shell"><p className="error-banner">{err}</p></div>
  if (!cases || !news) return <div className="shell"><p className="loading">Loading...</p></div>

  const totalConfirmed = cases.regions.reduce((s, r) => s + (r.confirmed ?? 0), 0)
  const totalSuspected = cases.regions.reduce((s, r) => s + (r.suspected ?? 0), 0)
  const totalDeaths    = cases.regions.reduce((s, r) => s + ((r as any).deaths ?? 0), 0)

  return (
    <div className="shell">
      <header className="top">
        <div className="top-left">
          <div className="top-pulse" aria-hidden="true" />
          <div>
            <h1>Hantavirus Signal Desk</h1>
            <p className="tag">MV Hondius outbreak | live news ingest | curated case ledger</p>
          </div>
        </div>
        <div className="top-meta">
          <span className="top-badge">Active outbreak</span>
          <span>Updated {cases.updated}</span>
        </div>
      </header>

      <div className="intel-card">
        <div className="intel-stat">
          <div className="intel-val" style={{ color: 'var(--confirmed)' }}>{totalConfirmed}</div>
          <div className="intel-lbl">Confirmed</div>
        </div>
        <div className="intel-stat">
          <div className="intel-val" style={{ color: 'var(--suspected)' }}>{totalSuspected}</div>
          <div className="intel-lbl">Suspected</div>
        </div>
        {totalDeaths > 0 && (
          <div className="intel-stat">
            <div className="intel-val" style={{ color: '#c0392b' }}>{totalDeaths}</div>
            <div className="intel-lbl">Deaths</div>
          </div>
        )}
        <div className="intel-divider" />
        <div className="intel-summary">
          Andes-strain hantavirus. Ship departed Ushuaia April 1 - now heading to Canary Islands.
          WHO global risk: <strong>low</strong>. Human-to-human transmission possible via close contact.
        </div>
      </div>

      <p className="disclaimer">{cases.disclaimer}</p>

      <main className="layout">
        <div className="left-col">
          <div className="map-pane">
            <OutbreakMap regions={cases.regions} onSelect={setSelectedId} mapRef={mapRef} />
          </div>
          <CaseTable />
        </div>
        <div className="side-pane">
          <RegionList regions={cases.regions} selectedId={selectedId} onSelect={setSelectedId} />
          <NewsColumn items={news.items} fetchedAt={news.fetched_at} />
        </div>
      </main>

      <FreshnessBar />

      <PivotChart cases={individualCases} />

      <footer className="footer">
        Edit <code>public/data/cases.json</code> to promote or demote signals as they develop.
      </footer>
    </div>
  )
}

