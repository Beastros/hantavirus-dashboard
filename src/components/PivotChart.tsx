interface Case {
  outcome?: string | null
  sex?: string | null
  nationality?: string | null
}

const OUTCOMES = ['died', 'confirmed', 'hospitalized', 'recovered', 'suspected'] as const
const O_COLORS: Record<string, string> = {
  died:         '#c0392b',
  confirmed:    '#f16b6b',
  hospitalized: '#f5a623',
  recovered:    '#3ecf8e',
  suspected:    '#8e9eb5',
}

export function PivotChart({ cases }: { cases: Case[] }) {
  if (!cases.length) return null

  const buckets = OUTCOMES
    .map(o => ({ label: o, count: cases.filter(c => c.outcome === o).length, color: O_COLORS[o] }))
    .filter(b => b.count > 0)

  const max = Math.max(...buckets.map(b => b.count), 1)
  const BAR_W = 56, GAP = 14, CHART_H = 90, TOP_PAD = 28, LABEL_H = 20
  const W = (BAR_W + GAP) * buckets.length

  const males   = cases.filter(c => c.sex === 'male').length
  const females = cases.filter(c => c.sex === 'female').length
  const unkSex  = cases.length - males - females
  const sexRows = [
    { label: 'Male',    count: males,   color: '#4fa8f0' },
    { label: 'Female',  count: females, color: '#f472b6' },
    { label: 'Unknown', count: unkSex,  color: '#6b7a92' },
  ].filter(x => x.count > 0)

  const nationalities = cases.reduce<Record<string, number>>((acc, c) => {
    const n = c.nationality || 'Unknown'
    acc[n] = (acc[n] || 0) + 1
    return acc
  }, {})
  const natRows = Object.entries(nationalities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)

  return (
    <section className="panel pivot-panel">
      <header className="panel-head">
        <h2>Case Analytics</h2>
      </header>
      <div className="pivot-wrap">

        <div className="pivot-section">
          <p className="pivot-label">Outcome distribution</p>
          <svg viewBox={"0 0 " + W + " " + (TOP_PAD + CHART_H + LABEL_H)} className="pivot-svg">
            {buckets.map((b, i) => {
              const barH = Math.max(4, (b.count / max) * CHART_H)
              const x = i * (BAR_W + GAP)
              const barY = TOP_PAD + (CHART_H - barH)
              return (
                <g key={b.label}>
                  <text x={x + BAR_W / 2} y={barY - 6}
                    textAnchor="middle" fill={b.color} fontSize={13} fontWeight="600">
                    {b.count}
                  </text>
                  <rect x={x} y={barY} width={BAR_W} height={barH}
                    fill={b.color} rx={3} opacity={0.88} />
                  <text x={x + BAR_W / 2} y={TOP_PAD + CHART_H + 14}
                    textAnchor="middle" fill="#6b7a92" fontSize={10}>
                    {b.label}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        <div className="pivot-section">
          <p className="pivot-label">Sex breakdown</p>
          <div className="sex-bars">
            {sexRows.map(x => (
              <div key={x.label} className="sex-row">
                <span className="sex-label">{x.label}</span>
                <div className="sex-bar-track">
                  <div className="sex-bar-fill"
                    style={{ width: (x.count / cases.length * 100) + '%', background: x.color }} />
                </div>
                <span className="sex-count" style={{ color: x.color }}>{x.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pivot-section">
          <p className="pivot-label">Nationality</p>
          <div className="sex-bars">
            {natRows.map(([name, count]) => (
              <div key={name} className="sex-row">
                <span className="sex-label" style={{ width: 64 }}>{name}</span>
                <div className="sex-bar-track">
                  <div className="sex-bar-fill"
                    style={{ width: (count / cases.length * 100) + '%', background: '#4fa8f0' }} />
                </div>
                <span className="sex-count" style={{ color: '#4fa8f0' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  )
}
