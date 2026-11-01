import { useEffect, useRef, useState } from "react";
import {
  CAMPUS_BOUNDS,
  CAMPUS_BOUNDS_ARRAY,
  CAMPUS_CENTER,
  isInsideCampus,
  type CampusCoordinate,
} from "@/lib/campus-location";

export type CampusMapMarker = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  detail?: string;
  /** Internal admin-report anchor for the selected item. */
  href?: string;
};

type MapMode = "picker" | "viewer";

type CampusMapProps = {
  mode?: MapMode;
  selectedPosition?: CampusCoordinate | null;
  onPositionChange?: (position: CampusCoordinate) => void;
  markers?: CampusMapMarker[];
  className?: string;
};

const EMPTY_MARKERS: CampusMapMarker[] = [];
const LEAFLET_CSS_ID = "campusfind-leaflet-css";
const LEAFLET_SCRIPT_ID = "campusfind-leaflet-script";
const LEAFLET_VERSION = "1.9.4";
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

type LeafletClickEvent = { latlng: CampusCoordinate };

interface LeafletMarker {
  addTo(target: LeafletMap | LeafletLayerGroup): LeafletMarker;
  bindPopup(content: HTMLElement): LeafletMarker;
}

interface LeafletLayerGroup {
  addTo(map: LeafletMap): LeafletLayerGroup;
  clearLayers(): void;
  addLayer(layer: LeafletMarker): LeafletLayerGroup;
}

interface LeafletMap {
  setView(center: [number, number], zoom: number): LeafletMap;
  setMaxBounds(bounds: unknown): LeafletMap;
  setMinZoom(zoom: number): LeafletMap;
  setMaxZoom(zoom: number): LeafletMap;
  on(event: "click", callback: (event: LeafletClickEvent) => void): LeafletMap;
  invalidateSize(): void;
  remove(): void;
}

interface LeafletApi {
  map(element: HTMLElement, options: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options: Record<string, unknown>): { addTo(map: LeafletMap): unknown };
  latLngBounds(bounds: [[number, number], [number, number]]): unknown;
  layerGroup(): LeafletLayerGroup;
  marker(position: [number, number]): LeafletMarker;
}

declare global {
  interface Window {
    L?: LeafletApi;
  }
}

let leafletPromise: Promise<LeafletApi> | null = null;

function loadLeaflet(): Promise<LeafletApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The map is only loaded in the browser."));
  }
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise<LeafletApi>((resolve, reject) => {
    if (!document.getElementById(LEAFLET_CSS_ID)) {
      const style = document.createElement("link");
      style.id = LEAFLET_CSS_ID;
      style.rel = "stylesheet";
      style.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
      document.head.appendChild(style);
    }

    const existing = document.getElementById(LEAFLET_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.id = LEAFLET_SCRIPT_ID;
    script.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    script.async = true;
    script.onload = () => {
      if (window.L) resolve(window.L);
      else reject(new Error("The map library loaded without its API."));
    };
    script.onerror = () => reject(new Error("The map library could not be downloaded."));
    if (!existing) document.body.appendChild(script);
  });

  return leafletPromise;
}

function popupContent(title: string, detail?: string, href?: string): HTMLElement {
  const wrapper = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  wrapper.appendChild(heading);
  if (detail) {
    const paragraph = document.createElement("p");
    paragraph.textContent = detail;
    paragraph.style.margin = "4px 0 0";
    wrapper.appendChild(paragraph);
  }
  if (href && /^#report-[0-9a-f-]+$/i.test(href)) {
    const linkRow = document.createElement("p");
    linkRow.style.margin = "8px 0 0";
    const link = document.createElement("a");
    link.href = href;
    link.textContent = "View report";
    link.style.color = "var(--primary)";
    link.style.fontWeight = "700";
    link.style.textDecoration = "underline";
    linkRow.appendChild(link);
    wrapper.appendChild(linkRow);
  }
  return wrapper;
}

export function CampusMap({
  mode = "viewer",
  selectedPosition = null,
  onPositionChange,
  markers = EMPTY_MARKERS,
  className = "",
}: CampusMapProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LeafletLayerGroup | null>(null);
  const selectedLayerRef = useRef<LeafletLayerGroup | null>(null);
  const latestPropsRef = useRef({ mode, onPositionChange });
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  latestPropsRef.current = { mode, onPositionChange };

  useEffect(() => {
    let cancelled = false;

    async function initialiseMap() {
      try {
        const leaflet = await loadLeaflet();
        if (cancelled || !elementRef.current) return;

        const bounds = leaflet.latLngBounds(CAMPUS_BOUNDS_ARRAY);
        const map = leaflet.map(elementRef.current, {
          zoomControl: true,
          scrollWheelZoom: true,
          minZoom: 15,
          maxZoom: 19,
          maxBounds: bounds,
          maxBoundsViscosity: 1,
        });
        map.setView(CAMPUS_CENTER, 16).setMaxBounds(bounds).setMinZoom(15).setMaxZoom(19);
        leaflet.tileLayer(TILE_URL, {
          attribution: TILE_ATTRIBUTION,
          minZoom: 15,
          maxZoom: 19,
          noWrap: true,
        }).addTo(map);

        mapRef.current = map;
        markerLayerRef.current = leaflet.layerGroup().addTo(map);
        selectedLayerRef.current = leaflet.layerGroup().addTo(map);

        map.on("click", (event) => {
          if (latestPropsRef.current.mode !== "picker") return;
          if (!isInsideCampus(event.latlng)) return;
          latestPropsRef.current.onPositionChange?.({
            lat: Number(event.latlng.lat.toFixed(6)),
            lng: Number(event.latlng.lng.toFixed(6)),
          });
        });

        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setMapError(true);
      }
    }

    void initialiseMap();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      selectedLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = window.L;
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    const selectedLayer = selectedLayerRef.current;
    if (!ready || !leaflet || !map || !markerLayer || !selectedLayer) return;

    markerLayer.clearLayers();
    selectedLayer.clearLayers();

    if (mode === "viewer") {
      for (const item of markers) {
        const position = { lat: item.lat, lng: item.lng };
        if (!isInsideCampus(position)) continue;
        markerLayer.addLayer(
          leaflet.marker([item.lat, item.lng]).bindPopup(popupContent(item.title, item.detail, item.href)),
        );
      }
    }

    if (mode === "picker" && selectedPosition && isInsideCampus(selectedPosition)) {
      selectedLayer.addLayer(
        leaflet.marker([selectedPosition.lat, selectedPosition.lng]).bindPopup(
          popupContent(
            "Selected campus location",
            `${selectedPosition.lat.toFixed(6)}, ${selectedPosition.lng.toFixed(6)}`,
          ),
        ),
      );
    }

    map.invalidateSize();
  }, [ready, mode, markers, selectedPosition?.lat, selectedPosition?.lng, selectedPosition]);

  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-secondary ${className}`}>
      <div
        ref={elementRef}
        className="h-[340px] w-full sm:h-[390px]"
        role="region"
        aria-label={mode === "picker" ? "Choose a location on the Chandigarh University campus map" : "Lost and found item locations on the Chandigarh University campus map"}
        aria-busy={!ready && !mapError}
      />
      {mapError && (
        <p role="alert" className="border-t border-border bg-card p-3 text-sm text-destructive">
          The campus map could not load. Check your internet connection and refresh this page.
        </p>
      )}
      {mode === "picker" && (
        <p className="border-t border-border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground">
          Tap or click the exact spot on the campus map. The map is locked to the Chandigarh University, Mohali campus area.
        </p>
      )}
      {mode === "viewer" && markers.length === 0 && (
        <p className="border-t border-border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground">
          No reports have a pinned location yet. New reports with campus map pins will appear here.
        </p>
      )}
    </div>
  );
}
