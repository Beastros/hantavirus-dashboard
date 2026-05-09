export function StrainReadout() {
  const rows = [
    { key: 'STRAIN',      val: 'ANDES VIRUS',       cls: 'strain-val-red' },
    { key: 'SYNDROME',    val: 'HPS / HCPS',        cls: '' },
    { key: 'VECTOR',      val: 'RODENT AEROSOL',    cls: '' },
    { key: 'H2H CAPABLE', val: 'YES (LIMITED)',      cls: 'strain-val-yellow' },
    { key: 'INCUBATION',  val: '1-6 WEEKS',         cls: '' },
    { key: 'CFR (ANDES)', val: '35-58%',            cls: 'strain-val-red' },
    { key: 'TREATMENT',   val: 'SUPPORTIVE ONLY',   cls: '' },
    { key: 'VACCINE',     val: 'NONE LICENSED',     cls: 'strain-val-red' },
  ]
  return (
    <div className="sb-section">
      <div className="sb-label">STRAIN READOUT</div>
      {rows.map(r => (
        <div key={r.key} className="strain-row">
          <span className="strain-key">{r.key}</span>
          <span className={`strain-val ${r.cls}`}>{r.val}</span>
        </div>
      ))}
    </div>
  )
}
