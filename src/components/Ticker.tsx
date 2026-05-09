import { useState, useEffect } from 'react'

interface TickerProps {
  items: Array<{ title: string; source_name: string; published_at?: string | null }>
}

export function Ticker({ items }: TickerProps) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const headlines = items.slice(0, 12)
  const text = headlines.map(i => i.title).join(' // ')
  const doubled = text + '     >>>     ' + text

  const hhmm = time.toUTCString().slice(17, 22) + ' UTC'

  return (
    <div className="ticker-bar">
      <div className="ticker-live">
        <div className="ticker-live-dot" />
        LIVE
      </div>
      <div className="ticker-scroll-wrap">
        <div className="ticker-scroll">
          {headlines.length > 0 ? (
            <span>{doubled}</span>
          ) : (
            <span className="ticker-item">HANTAVIRUS SIGNAL DESK // MV HONDIUS ANDES STRAIN // 5 CONFIRMED // 3 DEAD // SHIP EN ROUTE TENERIFE // WHO GLOBAL RISK: LOW // HANTAVIRUS SIGNAL DESK // MV HONDIUS ANDES STRAIN // 5 CONFIRMED // 3 DEAD // SHIP EN ROUTE TENERIFE // WHO GLOBAL RISK: LOW</span>
          )}
        </div>
      </div>
      <span className="ticker-time">{hhmm}</span>
      <span className="ticker-risk ticker-risk-low">WHO: LOW RISK</span>
    </div>
  )
}
