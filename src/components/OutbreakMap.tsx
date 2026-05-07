import React, { useMemo, useCallback, useState } from 'react'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import Map, { Layer, Popup, Source, type MapRef } from 'react-map-gl/maplibre'
import type { RegionCase } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

type Props = {
  regions: RegionCase[]
  onSelect: (id: string | null) => void
  mapRef: React.RefObject<MapRef | null>
}

type PopupInfo = {
  lng: number
  lat: number
  region: RegionCase
}

function toGeoJSON(regions: RegionCase[]) {
  return {
    type: 'FeatureCollection' as const,
    features: regions.map((r) => {
      const total = (r.confirmed ?? 0) + (r.probable ?? 0) + (r.suspected ?? 0)
      return {
        type: 'Feature' as const,
        properties: {
          id: r.id,
          name: r.name,
          confirmed: r.confirmed ?? 0,
          suspected: r.suspected ?? 0,
          probable: r.probable ?? 0,
          deaths: (r as any).deaths ?? 0,
          total,
          level: r.outbreak_level ?? 'informational',
          last_reported: r.last_reported ?? '',
        },
        geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
      }
    }),
  }
}

const LEVEL_LABELS: Record<string, string> = {
  informational: 'Unverified',
  elevated: 'Reported',
  high: 'Confirmed',
}

export function OutbreakMap({ regions, onSelect, mapRef }: Props) {
  const geojson = useMemo(() => toGeoJSON(regions), [regions])
  const [popup, setPopup] = useState<PopupInfo | null>(null)

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      const id = f?.properties?.id as string | undefined
      onSelect(id ?? null)
      if (id) {
        const region = regions.find((r) => r.id === id)
        if (region) setPopup({ lng: region.lng, lat: region.lat, region })
      } else {
        setPopup(null)
      }
    },
    [onSelect, regions],
  )

  return (
    <div className="map-shell">
      <Map
        ref={mapRef as React.RefObject<MapRef>}
        initialViewState={{ longitude: -10, latitude: 18, zoom: 1.5 }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={['outbreak-circles']}
        onClick={onClick}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="outbreak-points" type="geojson" data={geojson}>
          <Layer
            id="outbreak-circles"
            type="circle"
            paint={{
              'circle-radius': [
                'interpolate', ['linear'], ['sqrt', ['max', ['get', 'total'], 1]],
                0, 6, 1, 10, 3, 18, 8, 28,
              ],
              'circle-color': [
                'match', ['get', 'level'],
                'high',     '#f16b6b',
                'elevated', '#f5a623',
                '#3ecf8e',
              ],
              'circle-opacity': 0.88,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#080b10',
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
              <div className="mp-level">{LEVEL_LABELS[popup.region.outbreak_level ?? 'informational'] ?? popup.region.outbreak_level}</div>
              <div className="mp-stats">
                {(popup.region.confirmed ?? 0) > 0 && (
                  <span className="mp-confirmed">{popup.region.confirmed} confirmed</span>
                )}
                {((popup.region as any).deaths ?? 0) > 0 && (
                  <span className="mp-deaths">{(popup.region as any).deaths} deaths</span>
                )}
                {(popup.region.suspected ?? 0) > 0 && (
                  <span className="mp-suspected">{popup.region.suspected} suspected</span>
                )}
              </div>
              {popup.region.last_reported && (
                <div className="mp-date">Last report: {popup.region.last_reported}</div>
              )}
              {(popup.region as any).notes && (
                <div className="mp-notes">{(popup.region as any).notes}</div>
              )}
            </div>
          </Popup>
        )}
      </Map>

      <div className="map-legend">
        <span className="legend-dot leg-info" /> Unverified
        <span className="legend-dot leg-elev" /> Reported
        <span className="legend-dot leg-high" /> Confirmed
        <span className="legend-note">Dot size scales with case count. Click a dot for details.</span>
      </div>

      <button type="button" className="map-clear" onClick={() => { onSelect(null); setPopup(null) }}>
        Clear selection
      </button>
    </div>
  )
}
