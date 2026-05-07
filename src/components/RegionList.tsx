import type { RegionCase } from '../types'

type Props = {
  regions: RegionCase[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function Chip({ level }: { level: RegionCase['outbreak_level'] }) {
  const lv = level ?? 'informational'
  return <span className={`chip chip-${lv}`}>{lv}</span>
}

export function RegionList({ regions, selectedId, onSelect }: Props) {
  return (
    <section className="panel region-panel">
      <header className="panel-head">
        <h2>Case Ledger</h2>
        <p className="panel-sub">Click a row to fly the map to that location.</p>
      </header>
      <ul className="region-list">
        {regions.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={r.id === selectedId ? 'region-row active' : 'region-row'}
              onClick={() => onSelect(r.id === selectedId ? null : r.id)}
            >
              <div className="region-title">
                <strong>{r.name}</strong>
                <Chip level={r.outbreak_level} />
              </div>
              <div className="region-counts">
                <span className="count-confirmed">{r.confirmed ?? 0} confirmed</span>
                {(r.probable ?? 0) > 0 && (
                  <span className="count-probable"> &middot; {r.probable} probable</span>
                )}
                {(r.suspected ?? 0) > 0 && (
                  <span className="count-suspected"> &middot; {r.suspected} suspected</span>
                )}
              </div>
              {r.last_reported && (
                <div className="region-meta">Last report: {r.last_reported}</div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
