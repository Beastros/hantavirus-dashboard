interface IndividualCase {
  id: string
  nationality?: string | null
  age?: number | null
  sex?: string | null
  location?: string | null
  onset_date?: string | null
  outcome?: string | null
  notes?: string | null
}

const OUTCOME_COLORS: Record<string, string> = {
  died:         '#c0392b',
  confirmed:    '#f16b6b',
  hospitalized: '#f5a623',
  recovered:    '#3ecf8e',
  suspected:    '#8e9eb5',
}

function unk(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Unknown'
  return String(v)
}

export function CaseTable({ cases }: { cases: IndividualCase[] }) {
  if (!cases.length) return null

  return (
    <section className="panel case-table-panel">
      <header className="panel-head">
        <h2>Individual Case Registry</h2>
        <p className="panel-sub">
          Seeded from WHO reports | AI-enriched from news as data emerges | hover row for notes
        </p>
      </header>
      <div className="case-table-wrap">
        <table className="case-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Nationality</th>
              <th>Age</th>
              <th>Sex</th>
              <th>Location</th>
              <th>Onset</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c: IndividualCase, i: number) => (
              <tr key={c.id} title={c.notes || ''}>
                <td className="case-num">{i + 1}</td>
                <td>{unk(c.nationality)}</td>
                <td>{unk(c.age)}</td>
                <td>{unk(c.sex)}</td>
                <td>{unk(c.location)}</td>
                <td>{unk(c.onset_date)}</td>
                <td>
                  <span
                    className="outcome-chip"
                    style={{ color: OUTCOME_COLORS[c.outcome || ''] || 'var(--dim)' }}
                  >
                    {unk(c.outcome)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}


