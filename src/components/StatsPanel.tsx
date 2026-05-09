interface Case { outcome?: string | null }
interface Region { id: string; outbreak_level?: string }

export function StatsPanel({ cases, regions }: { cases: Case[]; regions: Region[] }) {
  const deaths    = cases.filter(c => c.outcome === 'died').length
  const confirmed = cases.filter(c => c.outcome === 'confirmed' || c.outcome === 'died').length
  const suspected = cases.filter(c => c.outcome === 'suspected' || c.outcome === 'hospitalized').length
  const countries = new Set(regions.filter(r => r.outbreak_level !== 'informational' || true).map(r => r.id.split('-')[0])).size
  const cfr = confirmed > 0 ? ((deaths / confirmed) * 100).toFixed(1) : '0'

  return (
    <div className="sb-section">
      <div className="sb-label">GLOBAL CLUSTER</div>
      <div className="stat-block">
        <div className="stat-label">CONFIRMED DEATHS</div>
        <div className="stat-val stat-red">{deaths}</div>
      </div>
      <div className="stat-block">
        <div className="stat-label">CONFIRMED CASES</div>
        <div className="stat-val stat-green">{confirmed}</div>
      </div>
      <div className="stat-block">
        <div className="stat-label">SUSPECTED CASES</div>
        <div className="stat-val stat-yellow">{suspected}</div>
      </div>
      <div className="stat-row">
        <div className="stat-block" style={{marginBottom:0}}>
          <div className="stat-label">COUNTRIES</div>
          <div className="stat-val stat-white" style={{fontSize:32}}>{countries}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div className="stat-label">CFR</div>
          <div className="stat-cfr">{cfr}%</div>
        </div>
      </div>
    </div>
  )
}
