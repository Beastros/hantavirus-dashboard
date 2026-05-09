import React, { useMemo, useCallback, useState } from 'react'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import Map, { Layer, Marker, Popup, Source, type MapRef } from 'react-map-gl/maplibre'
import type { RegionCase } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

type Props = {
  regions: RegionCase[]
  onSelect: (id: string | null) => void
  mapRef: React.RefObject<MapRef | null>
}

type PopupInfo = { lng: number; lat: number; region: RegionCase }

function toGeoJSON(regions: RegionCase[]) {
  return {
    type: 'FeatureCollection' as const,
    features: regions.map(r => ({
      type: 'Feature' as const,
      properties: {
        id: r.id, name: r.name,
        confirmed: r.confirmed ?? 0,
        suspected: r.suspected ?? 0,
        probable: r.probable ?? 0,
        deaths: (r as any).deaths ?? 0,
        total: (r.confirmed ?? 0) + (r.probable ?? 0) + (r.suspected ?? 0),
        level: r.outbreak_level ?? 'informational',
        last_reported: r.last_reported ?? '',
      },
      geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
    })),
  }
}

const LEVEL_LABELS: Record<string, string> = {
  informational: 'UNCONFIRMED REPORT',
  elevated: 'CORROBORATED',
  high: 'CONFIRMED',
}

const LEVEL_COLORS: Record<string, string> = {
  high: '#FF4444',
  elevated: '#FFB800',
  informational: '#00C853',
}

function estimateRt(regions: RegionCase[]) {
  const confirmed = regions.reduce((s,r) => s+(r.confirmed??0), 0)
  const suspected = regions.reduce((s,r) => s+(r.suspected??0), 0)
  const deaths    = regions.reduce((s,r) => s+((r as any).deaths??0), 0)
  const total = confirmed + suspected
  const baseR0 = {low:1.2, mid:1.6, high:2.1}
  const containment = total > 5 ? 0.55 : 0.7
  const cfr = total > 0 ? ((deaths/total)*100).toFixed(0) : '~35'
  return {
    rtLow: (baseR0.low*containment).toFixed(2),
    rtMid: (baseR0.mid*containment).toFixed(2),
    rtHigh: (baseR0.high*containment).toFixed(2),
    baseR0, cfr,
  }
}

export function OutbreakMap({ regions, onSelect, mapRef }: Props) {
  const geojson  = useMemo(() => toGeoJSON(regions), [regions])
  const [popup, setPopup] = useState<PopupInfo | null>(null)
  const rt = useMemo(() => estimateRt(regions), [regions])

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const f  = e.features?.[0]
    const id = f?.properties?.id as string | undefined
    onSelect(id ?? null)
    if (id) {
      const region = regions.find(r => r.id === id)
      if (region) setPopup({ lng: region.lng, lat: region.lat, region })
    } else {
      setPopup(null)
    }
  }, [onSelect, regions])

  const rtColor = parseFloat(rt.rtMid) > 1 ? '#FFB800' : '#00FF41'
  const rtLabel = parseFloat(rt.rtMid) > 1.5 ? 'GROWING' : parseFloat(rt.rtMid) > 1 ? 'SLOWING' : 'CONTROLLED'

  return (
    <div className="map-shell" style={{position:'relative', height:'100%', width:'100%', overflow:'hidden'}}>
      <Map
        ref={mapRef as React.RefObject<MapRef>}
        initialViewState={{ longitude: -10, latitude: 18, zoom: 1.5 }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={['outbreak-circles']}
        onClick={onClick}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Pulse rings as HTML markers - purely decorative, fast radar ping */}
        {regions.map(r => {
          const color = LEVEL_COLORS[r.outbreak_level ?? 'informational']
          const total = (r.confirmed ?? 0) + (r.suspected ?? 0) + (r.probable ?? 0) + ((r as any).deaths ?? 0)
          if (total === 0 && r.outbreak_level === 'informational') return null
          return (
            <Marker
              key={`pulse-${r.id}`}
              longitude={r.lng}
              latitude={r.lat}
              anchor="center"
              style={{ pointerEvents: 'none', zIndex: 0 }}
            >
              <div style={{ position: 'relative', width: 0, height: 0, pointerEvents: 'none' }}>
                <div
                  className="ping-ring"
                  style={{ '--ping-color': color } as React.CSSProperties}
                />
                <div
                  className="ping-ring ping-ring-2"
                  style={{ '--ping-color': color } as React.CSSProperties}
                />
              </div>
            </Marker>
          )
        })}

        <Source id="outbreak-points" type="geojson" data={geojson}>
          <Layer
            id="outbreak-circles"
            type="circle"
            paint={{
              'circle-radius': [
                'interpolate', ['linear'], ['sqrt', ['max', ['get', 'total'], 1]],
                0, 5, 1, 9, 3, 16, 8, 26,
              ],
              'circle-color': [
                'match', ['get', 'level'],
                'high', '#FF4444',
                'elevated', '#FFB800',
                '#00C853',
              ],
              'circle-opacity': 0.9,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#090C10',
            }}
          />
        </Source>

        {popup && (
          <Popup
            longitude={popup.lng}
            latitude={popup.lat}
            anchor="bottom"
            onClose={() => { setPopup(null); onSelect(null) }}
            closeOnClick={false}
            offset={12}
          >
            <div className="map-popup">
              <div className="mp-name">{popup.region.name}</div>
              <div className="mp-level">{LEVEL_LABELS[popup.region.outbreak_level ?? 'informational']}</div>
              <div className="mp-stats">
                {(popup.region.confirmed ?? 0) > 0 && <span className="mp-confirmed">{popup.region.confirmed} confirmed</span>}
                {((popup.region as any).deaths ?? 0) > 0 && <span className="mp-deaths">{(popup.region as any).deaths} deaths</span>}
                {(popup.region.suspected ?? 0) > 0 && <span className="mp-suspected">{popup.region.suspected} suspected</span>}
              </div>
              {popup.region.last_reported && <div className="mp-date">LAST REPORT: {popup.region.last_reported}</div>}
              {(popup.region as any).notes && <div className="mp-notes">{(popup.region as any).notes}</div>}
            </div>
          </Popup>
        )}
      </Map>

      <div className="map-legend">
        <span className="legend-dot leg-info" /> Unconfirmed Report
        <span className="legend-dot leg-elev" /> Corroborated
        <span className="legend-dot leg-high" /> Confirmed
        <span className="legend-note">Dot size = case count. Click for details.</span>
      </div>

      <div className="rt-panel" onClick={() => { setPopup(null); onSelect(null) }}>
        <div className="rt-header">
          <span className="rt-title">EST. RT</span>
          <span className="rt-status" style={{ color: rtColor }}>{rtLabel}</span>
        </div>
        <div className="rt-value" style={{ color: rtColor }}>{rt.rtMid}</div>
        <div className="rt-range">range {rt.rtLow}-{rt.rtHigh}</div>
        <div className="rt-divider" />
        <div className="rt-row"><span>ANDES R0</span><span>{rt.baseR0.low}-{rt.baseR0.high}</span></div>
        <div className="rt-row"><span>EST. CFR</span><span>~{rt.cfr}%</span></div>
        <div className="rt-row"><span>GEN. TIME</span><span>14-18d</span></div>
        <div className="rt-note">Shipboard containment applied. Click to clear.</div>
      </div>
    </div>
  )
}
