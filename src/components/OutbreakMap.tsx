import React, { useMemo, useCallback, useState, useEffect } from 'react'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import Map, { Layer, Popup, Source, type MapRef } from 'react-map-gl/maplibre'
import type { RegionCase } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'

interface ICase {
  id: string
  lat?: number | null; lng?: number | null
  origin_lat?: number | null; origin_lng?: number | null
  cluster_id?: string | null
  exposure_event?: string | null
  nationality?: string | null; age?: number | null; sex?: string | null
  location?: string | null; onset_date?: string | null
  outcome?: string | null; notes?: string | null
}

type Props = {
  regions: RegionCase[]
  individualCases: ICase[]
  onSelect: (id: string | null) => void
  mapRef: React.RefObject<MapRef>
}

const COLORS: Record<string, string> = {
  died: '#8B0000', confirmed: '#FF4444',
  hospitalized: '#FFB800', suspected: '#5A6B7A', recovered: '#00C853',
}

const EMPTY_GEO = { type: 'FeatureCollection' as const, features: [] as any[] }

function caseGeo(cases: ICase[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cases
      .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number')
      .map(c => ({
        type: 'Feature' as const,
        properties: { id: c.id, color: COLORS[c.outcome ?? 'suspected'] ?? '#5A6B7A' },
        geometry: { type: 'Point' as const, coordinates: [c.lng as number, c.lat as number] },
      })),
  }
}

function lineGeo(selected: ICase, all: ICase[], bold: boolean) {
  const cluster = all.filter(c =>
    c.cluster_id === selected.cluster_id &&
    typeof c.lat === 'number' && typeof c.origin_lat === 'number'
  )
  const targets = bold ? cluster.filter(c => c.id === selected.id) : cluster.filter(c => c.id !== selected.id)
  return {
    type: 'FeatureCollection' as const,
    features: targets.map(c => ({
      type: 'Feature' as const, properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [[c.origin_lng as number, c.origin_lat as number], [c.lng as number, c.lat as number]],
      },
    })),
  }
}

function originGeo(selected: ICase, all: ICase[]) {
  const c = all.find(x => x.cluster_id === selected.cluster_id && typeof x.origin_lat === 'number')
  if (!c) return EMPTY_GEO
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: { event: c.exposure_event ?? '' },
      geometry: { type: 'Point' as const, coordinates: [c.origin_lng as number, c.origin_lat as number] },
    }],
  }
}

function estRt(regions: RegionCase[]) {
  const conf = regions.reduce((s, r) => s + (r.confirmed ?? 0), 0)
  const susp = regions.reduce((s, r) => s + (r.suspected ?? 0), 0)
  const dead = regions.reduce((s, r) => s + ((r as any).deaths ?? 0), 0)
  const tot  = conf + susp
  const b = { low: 1.2, mid: 1.6, high: 2.1 }, k = tot > 5 ? 0.55 : 0.7
  return {
    lo: (b.low*k).toFixed(2), mid: (b.mid*k).toFixed(2), hi: (b.high*k).toFixed(2), b,
    cfr: tot > 0 ? ((dead/tot)*100).toFixed(0) : '~35',
  }
}

export function OutbreakMap({ regions, individualCases, onSelect, mapRef }: Props) {
  const rt = useMemo(() => estRt(regions), [regions])
  const [sel, setSel]     = useState<ICase | null>(null)
  const [popup, setPopup] = useState<{lng:number;lat:number;node:React.ReactNode}|null>(null)

  // Globe: poll until map style ready, then setProjection
  useEffect(() => {
    let n = 0
    const t = setInterval(() => {
      if (++n > 30) { clearInterval(t); return }
      const m = (mapRef as any)?.current?.getMap?.() as any
      if (!m?.isStyleLoaded?.()) return
      clearInterval(t)
      try { m.setProjection({ type: 'globe' }) } catch (_) {}
      try { m.setFog({ 'space-color': '#090C10', 'star-intensity': 0.6, 'horizon-blend': 0.04 }) } catch (_) {}
    }, 400)
    return () => clearInterval(t)
  }, [mapRef])

  const dots       = useMemo(() => caseGeo(individualCases), [individualCases])
  const boldLines  = useMemo(() => sel ? lineGeo(sel, individualCases, true)  : EMPTY_GEO, [sel, individualCases])
  const fadedLines = useMemo(() => sel ? lineGeo(sel, individualCases, false) : EMPTY_GEO, [sel, individualCases])
  const origin     = useMemo(() => sel ? originGeo(sel, individualCases) : EMPTY_GEO, [sel, individualCases])

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f) { setSel(null); setPopup(null); onSelect(null); return }
    const found = individualCases.find(c => c.id === f.properties?.id)
    if (!found || typeof found.lat !== 'number') return
    setSel(found)
    onSelect(found.id)
    setPopup({
      lng: found.lng as number,
      lat: found.lat as number,
      node: (
        <div className="map-popup">
          <div className="mp-name">{found.location ?? 'Unknown'}</div>
          <div className="mp-level" style={{color: COLORS[found.outcome ?? 'suspected']}}>
            {(found.outcome ?? 'unknown').toUpperCase()}
          </div>
          <div className="mp-stats">
            {found.nationality && <span>{found.nationality}</span>}
            {found.age != null && <span> Age {found.age}</span>}
            {found.sex && <span> {found.sex}</span>}
          </div>
          {found.onset_date && <div className="mp-date">ONSET: {found.onset_date}</div>}
          {found.exposure_event && (
            <div className="mp-date" style={{color:'#FFB800',marginTop:4}}>
              EXPOSURE: {found.exposure_event}
            </div>
          )}
          {found.notes && <div className="mp-notes">{found.notes}</div>}
        </div>
      ),
    })
  }, [individualCases, onSelect])

  const clear = useCallback(() => { setSel(null); setPopup(null); onSelect(null) }, [onSelect])

  const rtCol = parseFloat(rt.mid) > 1 ? '#FFB800' : '#00FF41'
  const rtLbl = parseFloat(rt.mid) > 1.5 ? 'GROWING' : parseFloat(rt.mid) > 1 ? 'SLOWING' : 'CONTROLLED'

  return (
    <div style={{position:'relative', width:'100%', height:'100%'}}>
      <Map
        ref={mapRef as React.RefObject<MapRef>}
        initialViewState={{ longitude: -20, latitude: 15, zoom: 1.6 }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={['case-dots']}
        onClick={onClick}
        style={{ width:'100%', height:'100%' }}
        dragRotate={true}
      >
        <Source id="faded-src" type="geojson" data={fadedLines}>
          <Layer id="faded-line" type="line" paint={{'line-color':'#FF8888','line-width':1,'line-opacity':0.3,'line-dasharray':[3,4]}} />
        </Source>
        <Source id="bold-src" type="geojson" data={boldLines}>
          <Layer id="bold-line" type="line" paint={{'line-color':'#FF4444','line-width':2.5,'line-opacity':0.9,'line-dasharray':[4,3]}} />
        </Source>
        <Source id="origin-src" type="geojson" data={origin}>
          <Layer id="origin-ring" type="circle" paint={{'circle-radius':14,'circle-color':'rgba(0,0,0,0)','circle-stroke-color':'#FF0000','circle-stroke-width':2,'circle-stroke-opacity':0.7}} />
          <Layer id="origin-dot"  type="circle" paint={{'circle-radius':6,'circle-color':'#FF0000','circle-stroke-color':'#FFFFFF','circle-stroke-width':1.5}} />
        </Source>
        <Source id="cases-src" type="geojson" data={dots}>
          <Layer id="case-pulse" type="circle" paint={{
            'circle-radius':['interpolate',['linear'],['zoom'],1,12,4,20],
            'circle-color':['get','color'],'circle-opacity':0,
            'circle-stroke-color':['get','color'],'circle-stroke-width':1.5,
            'circle-stroke-opacity':['interpolate',['linear'],['zoom'],1,0.35,4,0.08],
          }} />
          <Layer id="case-dots" type="circle" paint={{
            'circle-radius':7,
            'circle-color':['get','color'],
            'circle-opacity':0.92,
            'circle-stroke-color':'#090C10',
            'circle-stroke-width':1.5,
          }} />
        </Source>
        {popup && (
          <Popup longitude={popup.lng} latitude={popup.lat} anchor="bottom" onClose={clear} closeOnClick={false} offset={12}>
            {popup.node}
          </Popup>
        )}
      </Map>

      <div className="map-legend">
        {Object.entries(COLORS).map(([k,v]) => (
          <span key={k}><span className="legend-dot" style={{background:v}} /> {k}</span>
        ))}
        <span className="legend-note">Click dot for exposure traceback. Red dot = origin event.</span>
      </div>

      <div className="rt-panel" onClick={clear}>
        <div className="rt-header">
          <span className="rt-title">EST. RT</span>
          <span className="rt-status" style={{color:rtCol}}>{rtLbl}</span>
        </div>
        <div className="rt-value" style={{color:rtCol}}>{rt.mid}</div>
        <div className="rt-range">range {rt.lo}-{rt.hi}</div>
        <div className="rt-divider" />
        <div className="rt-row"><span>ANDES R0</span><span>{rt.b.low}-{rt.b.high}</span></div>
        <div className="rt-row"><span>EST. CFR</span><span>~{rt.cfr}%</span></div>
        <div className="rt-row"><span>GEN. TIME</span><span>14-18d</span></div>
        <div className="rt-note">Click to clear selection.</div>
      </div>
    </div>
  )
}

