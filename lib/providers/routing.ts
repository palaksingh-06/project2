import { getFallbackRates } from "@/lib/config";
import type { Provenance } from "@/lib/zbc/provenance";
import { haversineKm } from "@/lib/utils/haversine";
import { canCallGoogle, recordGoogleCall } from "@/lib/providers/google-quota";

export interface DistanceResult {
  distance_km: number;
  provenance: Provenance;
  duration_hours?: number;
}

export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][]; // [lng, lat], GeoJSON order
}

export interface RouteResult {
  distance_km: number;
  duration_hours?: number;
  provenance: Provenance;
  geometry: RouteGeometry; // always populated — real route, or straight-line estimate as fallback
  source: "google" | "ors" | "estimate"; // machine-readable — which path actually produced this result
}

// ── Google Routes API toggle ──────────────────────────────────────────────────
// Controlled by GOOGLE_ROUTES_ENABLED env variable. While off, distance falls
// through to OpenRouteService (if keyed) then the straight-line × road-factor estimate.
async function routeGoogle(
  waypoints: { lat: number; lng: number }[],
  apiKey: string
): Promise<RouteResult | "blocked" | null> {
  if (process.env.GOOGLE_ROUTES_ENABLED !== "true") return null;

  // Airtight cap: stop calling Google once the monthly free tier is reached.
  if (!canCallGoogle("routes")) return "blocked";

  const origin = waypoints[0];
  const destination = waypoints[waypoints.length - 1];
  const intermediates = waypoints.slice(1, -1);

  try {
    const res = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          ...(intermediates.length
            ? { intermediates: intermediates.map((p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })) }
            : {}),
          travelMode: "DRIVE",
          polylineEncoding: "GEO_JSON_LINESTRING",
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    recordGoogleCall("routes"); // billable request dispatched
    if (res.status === 429) return "blocked";
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: {
        distanceMeters?: number;
        duration?: string;
        polyline?: { geoJsonLinestring?: { type: string; coordinates: [number, number][] } };
      }[];
    };
    const route = data.routes?.[0];
    if (!route?.distanceMeters || !route.polyline?.geoJsonLinestring) return null;
    const durationSecs = route.duration ? parseInt(route.duration) : undefined;
    return {
      distance_km: route.distanceMeters / 1000,
      duration_hours: durationSecs ? durationSecs / 3600 : undefined,
      geometry: { type: "LineString", coordinates: route.polyline.geoJsonLinestring.coordinates },
      source: "google",
      provenance: { kind: "api", label: "Google Routes API", detail: "DRIVE mode" },
    };
  } catch {
    return null;
  }
}

async function routeORS(
  waypoints: { lat: number; lng: number }[],
  apiKey: string
): Promise<RouteResult | null> {
  const body = {
    coordinates: waypoints.map((p) => [p.lng, p.lat]),
  };
  try {
    const res = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: {
        geometry?: { type: string; coordinates: [number, number][] };
        properties?: { summary?: { distance: number; duration: number } };
      }[];
    };
    const feature = data.features?.[0];
    const summary = feature?.properties?.summary;
    if (!summary || !feature?.geometry) return null;
    return {
      distance_km: summary.distance / 1000,
      duration_hours: summary.duration / 3600,
      geometry: { type: "LineString", coordinates: feature.geometry.coordinates },
      source: "ors",
      provenance: {
        kind: "api",
        label: "OpenRouteService",
        detail: "driving-car profile",
      },
    };
  } catch {
    return null;
  }
}

export async function getRoute(
  waypoints: { lat: number; lng: number }[]
): Promise<RouteResult> {
  if (waypoints.length < 2) {
    throw new Error("getRoute requires at least 2 waypoints");
  }

  let googleBlocked = false;

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const g = await routeGoogle(waypoints, googleKey);
    if (g === "blocked") googleBlocked = true;
    else if (g) return g;
  }

  const orsKey = process.env.OPENROUTESERVICE_API_KEY;
  if (orsKey) {
    const o = await routeORS(waypoints, orsKey);
    if (o) {
      // Flag as a fallback (red badge) only if Google was blocked by its cap.
      return googleBlocked
        ? { ...o, provenance: { kind: "error", label: "Google Routes limit reached → OpenRouteService", detail: o.provenance.label } }
        : o;
    }
  }

  // Haversine fallback: straight-line × road-factor summed across consecutive
  // waypoints, plus a synthesized straight-line LineString through all
  // waypoints so the map always has something to draw (clearly flagged via
  // `source`/`provenance` as an estimate, not a real routed path).
  const fallback = getFallbackRates();
  let totalStraight = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    totalStraight += haversineKm(
      waypoints[i].lat,
      waypoints[i].lng,
      waypoints[i + 1].lat,
      waypoints[i + 1].lng
    );
  }

  return {
    distance_km: Math.round(totalStraight * fallback.road_factor),
    geometry: {
      type: "LineString",
      coordinates: waypoints.map((p) => [p.lng, p.lat]),
    },
    source: "estimate",
    provenance: googleBlocked
      ? {
          kind: "error",
          label: "Google Routes limit reached → estimate",
          detail: `straight-line × ${fallback.road_factor}`,
        }
      : {
          kind: "estimate",
          label: "Straight-line × road factor",
          detail: `config/fallback-rates.json (factor ${fallback.road_factor})`,
        },
  };
}

// Back-compat shim for the legacy single-leg batch/`lib/zbc` path. Do not add
// new callers — use getRoute() directly for anything that needs multi-waypoint
// or geometry data.
export async function getRouteDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<DistanceResult> {
  const r = await getRoute([origin, destination]);
  return {
    distance_km: r.distance_km,
    duration_hours: r.duration_hours,
    provenance: r.provenance,
  };
}
