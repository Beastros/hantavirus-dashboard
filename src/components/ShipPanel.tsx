export function ShipPanel() {
  const rows = [
    { key: 'STATUS',      val: 'EN ROUTE -> TENERIFE', cls: 'ship-val-yellow' },
    { key: 'DEPARTED',    val: 'USHUAIA 2026-04-01',   cls: '' },
    { key: 'ABOARD',      val: '149 (88 PAX + 61 CREW)',cls: '' },
    { key: 'NATIONALITIES',val: '23',                  cls: '' },
    { key: 'TENERIFE',    val: 'APPROVED (SPAIN)',      cls: 'ship-val-green' },
    { key: 'PREV ANCHOR', val: 'CAPE VERDE',            cls: '' },
    { key: 'US CHARTER',  val: 'OMAHA NE - 17 PAX',    cls: 'ship-val-yellow' },
  ]
  return (
    <div className="sb-section">
      <div className="sb-label">
        <span className="ship-status-dot" />
        MV HONDIUS
      </div>
      {rows.map(r => (
        <div key={r.key} className="ship-row">
          <span className="ship-key">{r.key}</span>
          <span className={`ship-val ${r.cls}`}>{r.val}</span>
        </div>
      ))}
    </div>
  )
}
