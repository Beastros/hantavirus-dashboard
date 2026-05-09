import { useEffect, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { OutbreakMap } from './components/OutbreakMap'
import { IntelFeed } from './components/IntelFeed'
import { RegionList } from './components/RegionList'
import { FreshnessBar } from './components/FreshnessBar'
import { CaseTable } from './components/CaseTable'
import { PivotChart } from './components/PivotChart'
import { Ticker } from './components/Ticker'
import { StatsPanel } from './components/StatsPanel'
import { ShipPanel } from './components/ShipPanel'
import { StrainReadout } from './components/StrainReadout'
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

  if (err) return <div className="shell"><p className="error-banner">{err}</p></div>
  if (!cases || !news) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:"'Share Tech Mono',monospace",color:'#00FF41',fontSize:'14px',letterSpacing:'.15em',background:'#090C10'}}>
      INITIALIZING SIGNAL DESK...
    </div>
  )

  const totalConfirmed = individualCases.filter((c: any) => c.outcome === 'confirmed' || c.outcome === 'died').length
  const totalSuspected = individualCases.filter((c: any) => c.outcome === 'suspected' || c.outcome === 'hospitalized').length
  const totalDeaths    = individualCases.filter((c: any) => c.outcome === 'died').length

  return (
    <div className="shell">
      <Ticker items={news.items} />

      <div className="source-bar">
        // SOURCE: WHO DON599 - CDC - REUTERS - BBC - LAST SYNC: {new Date(news.fetched_at).toUTCString().slice(0,25)}
      </div>

      <div className="intel-card">
        <div className="intel-stat">
          <div className="intel-val" style={{color:'var(--confirmed)'}}>{totalConfirmed}</div>
          <div className="intel-lbl">CONFIRMED</div>
        </div>
        <div className="intel-stat">
          <div className="intel-val" style={{color:'var(--suspected)'}}>{totalSuspected}</div>
          <div className="intel-lbl">SUSPECTED</div>
        </div>
        <div className="intel-stat">
          <div className="intel-val" style={{color:'#CC0000'}}>{totalDeaths}</div>
          <div className="intel-lbl">DEATHS</div>
        </div>
        <div className="intel-divider" />
        <div className="intel-summary">
          Andes-strain hantavirus. MV Hondius en route Tenerife, arriving May 9.
          WHO global risk: <strong style={{color:'var(--informational)'}}>LOW</strong>.
          H2H transmission: limited close contact only.
        </div>
        <div style={{marginLeft:'auto',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
          <span className="top-badge">ACTIVE OUTBREAK</span>
          <span style={{fontSize:'.65rem',color:'var(--muted)',fontFamily:"'Share Tech Mono',monospace"}}>
            UPDATED {cases.updated.slice(0,10)}
          </span>
        </div>
      </div>

      <p className="disclaimer">{cases.disclaimer}</p>

      {/* Main 3-column grid â€” fixed height, does not stretch */}
      <div className="main-grid">
        <div className="left-col">
          <StatsPanel cases={individualCases} regions={cases.regions} />
          <ShipPanel />
          <StrainReadout />
          <div className="sb-section" style={{flex:1,overflowY:'auto'}}>
            <RegionList regions={cases.regions} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>

        <div className="map-col">
          <OutbreakMap
            regions={cases.regions}
            individualCases={individualCases}
            onSelect={setSelectedId}
            mapRef={mapRef}
          />
        </div>

        <div className="right-col">
          <IntelFeed items={news.items} fetchedAt={news.fetched_at} />
        </div>
      </div>

      <FreshnessBar />

      {/* Analytics below â€” page scrolls here */}
      <div style={{padding:'1rem 1rem 0'}}>
        <div className="analytics-row">
          <CaseTable />
          <PivotChart cases={individualCases} />
        </div>
      </div>

      <footer className="footer">
        // Edit public/data/cases.json to promote or demote signals. Ingest runs every 15 min.
      </footer>
    </div>
  )
}
