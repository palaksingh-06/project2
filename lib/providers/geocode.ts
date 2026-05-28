import { getCitiesCache } from "@/lib/config";
import type { Provenance } from "@/lib/zbc/provenance";
import { suggestCities } from "@/lib/utils/spellcheck";

export interface GeocodeResult {
  name: string;
  state: string;
  lat: number;
  lng: number;
  provenance: Provenance;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function geocodeFromCache(cityName: string): GeocodeResult | null {
  const q = normalize(cityName);
  const cities = getCitiesCache();
  const match = cities.find((c) => normalize(c.name) === q);
  if (!match) return null;
  return {
    name: match.name,
    state: match.state,
    lat: match.lat,
    lng: match.lng,
    provenance: {
      kind: "config",
      label: "City cache",
      detail: "config/cities-cache.json",
    },
  };
}

async function geocodeGoogle(cityName: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${cityName}, India`);
  url.searchParams.set("components", "country:IN");
  url.searchParams.set("key", apiKey);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results: {
        geometry: { location: { lat: number; lng: number } };
        address_components: { long_name: string; types: string[] }[];
      }[];
    };
    if (data.status !== "OK" || !data.results.length) return null;
    const hit = data.results[0];
    const stateComp = hit.address_components.find((c) =>
      c.types.includes("administrative_area_level_1")
    );
    return {
      name: cityName,
      state: stateComp?.long_name ?? "India",
      lat: hit.geometry.location.lat,
      lng: hit.geometry.location.lng,
      provenance: { kind: "api", label: "Google Geocoding" },
    };
  } catch {
    return null;
  }
}

export async function geocodeNominatim(
  cityName: string
): Promise<GeocodeResult | null> {
  const query = encodeURIComponent(`${cityName}, India`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=in`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ZeroBasedCosting/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      lat: string;
      lon: string;
      display_name: string;
      address?: { state?: string };
    }[];
    if (!data.length) return null;
    const hit = data[0];
    const state =
      hit.address?.state ??
      hit.display_name.split(",").slice(-2, -1)[0]?.trim() ??
      "India";
    return {
      name: cityName,
      state,
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      provenance: {
        kind: "api",
        label: "OpenStreetMap Nominatim",
      },
    };
  } catch {
    return null;
  }
}

export async function geocode(cityName: string): Promise<{
  result: GeocodeResult | null;
  suggestions: string[];
}> {
  const cached = geocodeFromCache(cityName);
  if (cached) return { result: cached, suggestions: [] };

  const google = await geocodeGoogle(cityName);
  if (google) return { result: google, suggestions: [] };

  const nominatim = await geocodeNominatim(cityName);
  if (nominatim) return { result: nominatim, suggestions: [] };

  const suggestions = suggestCities(cityName, getCitiesCache());
  return { result: null, suggestions };
}
