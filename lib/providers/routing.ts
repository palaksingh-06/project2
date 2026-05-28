import { getFallbackRates } from "@/lib/config";
import type { Provenance } from "@/lib/zbc/provenance";
import { haversineKm } from "@/lib/utils/haversine";

export interface DistanceResult {
  distance_km: number;
  provenance: Provenance;
  duration_hours?: number;
}

async function routeGoogle(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string
): Promise<DistanceResult | null> {
  try {
    const res = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          travelMode: "DRIVE",
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: { distanceMeters?: number; duration?: string }[];
    };
    const route = data.routes?.[0];
    if (!route?.distanceMeters) return null;
    const durationSecs = route.duration ? parseInt(route.duration) : undefined;
    return {
      distance_km: route.distanceMeters / 1000,
      duration_hours: durationSecs ? durationSecs / 3600 : undefined,
      provenance: { kind: "api", label: "Google Routes API", detail: "DRIVE mode" },
    };
  } catch {
    return null;
  }
}

async function routeORS(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string
): Promise<DistanceResult | null> {
  const body = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
  };
  try {
    const res = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car",
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      routes?: { summary?: { distance: number; duration: number } }[];
    };
    const summary = data.routes?.[0]?.summary;
    if (!summary) return null;
    return {
      distance_km: summary.distance / 1000,
      duration_hours: summary.duration / 3600,
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

export async function getRouteDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<DistanceResult> {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const g = await routeGoogle(origin, destination, googleKey);
    if (g) return g;
  }

  const orsKey = process.env.OPENROUTESERVICE_API_KEY;
  if (orsKey) {
    const o = await routeORS(origin, destination, orsKey);
    if (o) return o;
  }

  const fallback = getFallbackRates();
  const straight = haversineKm(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng
  );
  return {
    distance_km: Math.round(straight * fallback.road_factor),
    provenance: {
      kind: "estimate",
      label: "Straight-line × road factor",
      detail: `config/fallback-rates.json (factor ${fallback.road_factor})`,
    },
  };
}
