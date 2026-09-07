"use client";

// RouteMap: draws the actual road route between the trip's origin and
// destination using Leaflet (map rendering) + OSRM (free routing engine,
// no API key). Coordinates are already available on result.meta.origin/
// destination — geocoded upstream during cost calculation — so this
// component skips geocoding entirely and goes straight to routing.

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

interface RoutePoint {
  name: string;
  lat?: number;
  lng?: number;
}

export interface RouteMapProps {
  origin: RoutePoint;
  destination: RoutePoint;
}

export function RouteMap({ origin, destination }: RouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const [status, setStatus] = useState<string>("Loading map…");

  const hasCoords =
    origin.lat != null && origin.lng != null && destination.lat != null && destination.lng != null;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!mapContainerRef.current) return;

      if (!hasCoords) {
        setStatus("Coordinates aren't available for this trip's origin/destination, so the route can't be plotted.");
        return;
      }

      const L = (await import("leaflet")).default;

      // Next.js bundling breaks Leaflet's default marker icon URLs — point them at the CDN instead.
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (cancelled || !mapContainerRef.current) return;

      // Guard against double-initialization (React StrictMode double-invokes effects in dev).
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const oLat = origin.lat as number;
      const oLng = origin.lng as number;
      const dLat = destination.lat as number;
      const dLng = destination.lng as number;

      const map = L.map(mapContainerRef.current).setView(
        [(oLat + dLat) / 2, (oLng + dLng) / 2],
        6
      );
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 18,
      }).addTo(map);

      L.marker([oLat, oLng]).addTo(map).bindPopup(`Origin: ${origin.name}`);
      L.marker([dLat, dLng]).addTo(map).bindPopup(`Destination: ${destination.name}`);

      setStatus("Fetching road route…");

      try {
        const url =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();

        if (cancelled) return;

        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const coords = route.geometry.coordinates.map(
            (c: number[]) => [c[1], c[0]] as [number, number]
          );
          const line = L.polyline(coords, { color: "#c2410c", weight: 4, opacity: 0.85 }).addTo(map);
          map.fitBounds(line.getBounds(), { padding: [30, 30] });

          setStatus("");
        } else {
          map.fitBounds(L.latLngBounds([oLat, oLng], [dLat, dLng]), { padding: [30, 30] });
          setStatus("Couldn't calculate a road route between these points — showing markers only.");
        }
      } catch {
        if (!cancelled) {
          map.fitBounds(L.latLngBounds([oLat, oLng], [dLat, dLng]), { padding: [30, 30] });
          setStatus("Couldn't reach the routing service. Showing markers only.");
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.lat, origin.lng, destination.lat, destination.lng, hasCoords]);

  return (
    <div className="space-y-3">
      <div
        ref={mapContainerRef}
        className="h-[420px] w-full rounded-xl border border-slate-200 bg-slate-50"
      />
      {status && <p className="text-sm text-slate-500">{status}</p>}
    </div>
  );
}
