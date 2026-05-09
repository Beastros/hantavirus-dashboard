import React, { useMemo, useCallback, useState } from 'react'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import Map, { Layer, Popup, Source, type MapRef } from 'react-map-gl/maplibre'
import type { RegionCase } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'

interface IndividualCase {
  id: string
  lat?: number | null
  lng?: number | null
  origin_lat?: number | null
  origin_lng?: number | null
  cluster_id?: string | null
  exposure_event?: string | null
  nationality?: string | null
  age?: number | null
  sex?: string | null
  location?: string | null
  onset_date?: string | null
  outcome?: string | null
  notes?: string | null
}

type Props = {
  regions: RegionCase[]
  individualCases: IndividualCase[]
  onSelect: (id: string | null) => void
  mapRef: React.RefObject<MapRef | null>
}

const OUTCOME_COLORS: Record<string, string> = {
  died:         '#8B0000',
  confirmed:    '#FF4444',
  hospitalized: '#FFB800',
  suspected:    '#6B7A8B',
  recovered:    '#00C853',
}

function buildCaseGeoJSON(cases: IndividualCase[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cases
      .filter(c => c.lat != null && c.lng != null)
      .map(c => ({
        type: 'Feature' as const,
        properties: {
          id: c.id,
          outcome: c.outcome ?? 'suspected',
          color: OUTCOME_COLORS[c.outcome ?? 'suspected'] ?? '#6B7A8B',
          label: `${c.nationality ?? '?'} / ${c.outcome ?? '?'}`,
        },
        geometry: { type: 'Point' as const, coordinates: [c.lng!, c.lat!] },
      })),
  }
}

function buildOriginGeoJSON(cases: IndividualCase[], clusterId: string | null) {
  if (!clusterId) return { type: 'FeatureCollection' as const, features: [] }
  const clusterCases = cases.filter(c => c.cluster_id === clusterId && c.origin_lat != null)
  if (!clusterCases.length) return { type: 'FeatureCollection' as const, features: [] }
  const first = clusterCases[0]
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: { event: first.exposure_event ?? 'Exposure event' },
      geometry: { type: 'Point' as const, coordinates: [first.origin_lng!, first.origin_lat!] },
    }],
  }
}

function buildTracebackGeoJSON(
  selected: IndividualCase,
  allCases: IndividualCase[],
  bold: boolean
) {
  const cluster = allCases.filter(c =>
    c.cluster_id === selected.cluster_id &&
    c.lat != null && c.lng != null &&
    c.origin_lat != null && c.origin_lng != null
  )
  const targets = bold
    ? cluster.filter(c => c.id === selected.id)
    : cluster.filter(c => c.id !== selected.id)

  return {
    type: 'FeatureCollection' as const,
    features: targets.map(c => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [c.origin_lng!, c.origin_lat!],
          [c.lng!, c.lat!],
        ],
      },
    })),
  }
}

function estimateRt(regions: RegionCase[]) {
  const confirmed = regions.reduce((s, r) => s + (r.confirmed ?? 0), 0)
  const suspected = regions.reduce((s, r) => s + (r.suspected ?? 0), 0)
  const deaths    = regions.reduce((s, r) => s + ((r as any).deaths ?? 0), 0)
  const total = confirmed + suspected
  const baseR0 = { low: 1.2, mid: 1.6, high: 2.1 }
  const containment = total > 5 ? 0.55 : 0.7
  const cfr = total > 0 ? ((deaths / total) * 100).toFixed(0) : '~35'
  return {
    rtLow:  (baseR0.low  * containment).toFixed(2),
    rtMid:  (baseR0.mid  * containment).toFixed(2),
    rtHigh: (baseR0.high * containment).toFixed(2),
    baseR0, cfr,
  }
}

export function OutbreakMap({ regions, individualCases, onSelect, mapRef }: Props) {
  const rt = useMemo(() => estimateRt(regions), [regions])
  const [selectedCase, setSelectedCase] = useState<IndividualCase | null>(null)
  const [popup, setPopup] = useState<{ lng: number; lat: number; content: React.ReactNode } | null>(null)

  const caseGeoJSON    = useMemo(() => buildCaseGeoJSON(individualCases), [individualCases])
  const boldLines      = useMemo(() => selectedCase ? buildTracebackGeoJSON(selectedCase, individualCases, true)  : { type: 'FeatureCollection' as const, features: [] }, [selectedCase, individualCases])
  const fadedLines     = useMemo(() => selectedCase ? buildTracebackGeoJSON(selectedCase, individualCases, false) : { type: 'FeatureCollection' as const, features: [] }, [selectedCase, individualCases])
  const originGeoJSON  = useMemo(() => buildOriginGeoJSON(individualCases, selectedCase?.cluster_id ?? null), [selectedCase, individualCases])

  const onMapLoad = useCallback((e: any) => {
    try {
      e.target.setProjection({ type: 'globe' })
      e.target.setFog({
        'space-color': '#090C10',
        'star-intensity': 0.7,
        'color': 'rgba(15, 30, 20, 0.9)',
        'high-color': 'rgba(8, 16, 12, 1)',
        'horizon-blend': 0.03,
      })
    } catch (err) {
      console.warn('Globe projection not supported:', err)
    }
  }, [])

  const onCaseClick = useCallback((e: MapLayerMouseEvent) => {
    const f  = e.features?.[0]
    if (!f) return
    const caseId = f.properties?.id as string
    const found  = individualCases.find(c => c.id === caseId)
    if (!found || !found.lat || !found.lng) return

    setSelectedCase(found)
    onSelect(caseId)

    const content = (
      <div className="map-popup">
        <div className="mp-name">{found.location ?? 'Unknown location'}</div>
        <div className="mp-level">{(found.outcome ?? 'unknown').toUpperCase()}</div>
        <div className="mp-stats">
          {found.nationality && <span style={{color:'var(--dim)'}}>{found.nationality}</span>}
          {found.age && <span style={{color:'var(--dim)'}}> Â· Age {found.age}</span>}
          {found.sex && <span style={{color:'var(--dim)'}}> Â· {found.sex}</span>}
        </div>
        {found.onset_date && <div className="mp-date">ONSET: {found.onset_date}</div>}
        {found.exposure_event && (
          <div className="mp-date" style={{color:'#FFB800', marginTop:4}}>
            EXPOSURE: {found.exposure_event}
          </div>
        )}
        {found.notes && <div className="mp-notes">{found.notes}</div>}
      </div>
    )
    setPopup({ lng: found.lng, lat: found.lat, content })
  }, [individualCases, onSelect])

  const clearSelection = useCallback(() => {
    setSelectedCase(null)
    setPopup(null)
    onSelect(null)
  }, [onSelect])

  const rtColor = parseFloat(rt.rtMid) > 1 ? '#FFB800' : '#00FF41'
  const rtLabel = parseFloat(rt.rtMid) > 1.5 ? 'GROWING' : parseFloat(rt.rtMid) > 1 ? 'SLOWING' : 'CONTROLLED'

  
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={mapRef as React.RefObject<MapRef>}
        initialViewState={{ longitude: -20, latitude: 10, zoom: 1.6 }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={['case-dots']}
        onClick={onCaseClick}
        onMouseLeave={clearSelection}
        onLoad={onMapLoad}
        style={{ width: '100%', height: '100%' }}
        dragRotate={true}
        touchZoomRotate={true}
      >
        {/* Faded traceback lines â€” other cluster cases */}
        <Source id="traceback-faded" type="geojson" data={fadedLines}>
          <Layer id="traceback-faded-line" type="line" paint={{
            'line-color': '#FF8888',
            'line-width': 1,
            'line-opacity': 0.3,
            'line-dasharray': [3, 4],
          }} />
        </Source>

        {/* Bold traceback line â€” selected case */}
        <Source id="traceback-bold" type="geojson" data={boldLines}>
          <Layer id="traceback-bold-line" type="line" paint={{
            'line-color': '#FF4444',
            'line-width': 2,
            'line-opacity': 0.85,
            'line-dasharray': [4, 3],
          }} />
        </Source>

        {/* Origin event marker */}
        <Source id="origin-pts" type="geojson" data={originGeoJSON}>
          <Layer id="origin-glow" type="circle" paint={{
            'circle-radius': 16,
            'circle-color': 'transparent',
            'circle-stroke-color': '#FF4444',
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.6,
          }} />
          <Layer id="origin-dot" type="circle" paint={{
            'circle-radius': 7,
            'circle-color': '#FF0000',
            'circle-opacity': 0.9,
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': 1.5,
          }} />
        </Source>

        {/* Individual case dots */}
        <Source id="case-pts" type="geojson" data={caseGeoJSON}>
          {/* Pulse ring */}
          <Layer id="case-pulse" type="circle" paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 18],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 4, 0.1],
          }} />
          {/* Main dot */}
          <Layer id="case-dots" type="circle" paint={{
            'circle-radius': 7,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#090C10',
            'circle-stroke-width': 1.5,
          }} />
        </Source>

        {popup && (
          <Popup
            longitude={popup.lng}
            latitude={popup.lat}
            anchor="bottom"
            onClose={clearSelection}
            closeOnClick={false}
            offset={12}
          >
            {popup.content}
          </Popup>
        )}
      </Map>

      {/* Legend */}
      <div className="map-legend">
        {Object.entries(OUTCOME_COLORS).map(([k, v]) => (
          <span key={k}><span className="legend-dot" style={{background:v}} /> {k}</span>
        ))}
        <span className="legend-note">Click a dot to show exposure traceback. Dashed lines = transmission path.</span>
      </div>

      {/* Rt panel */}
      <div className="rt-panel" onClick={clearSelection}>
        <div className="rt-header">
          <span className="rt-title">EST. RT</span>
          <span className="rt-status" style={{color:rtColor}}>{rtLabel}</span>
        </div>
        <div className="rt-value" style={{color:rtColor}}>{rt.rtMid}</div>
        <div className="rt-range">range {rt.rtLow}-{rt.rtHigh}</div>
        <div className="rt-divider" />
        <div className="rt-row"><span>ANDES R0</span><span>{rt.baseR0.low}-{rt.baseR0.high}</span></div>
        <div className="rt-row"><span>EST. CFR</span><span>~{rt.cfr}%</span></div>
        <div className="rt-row"><span>GEN. TIME</span><span>14-18d</span></div>
        <div className="rt-note">Click to clear selection.</div>
      </div>
    </div>
  )
}



