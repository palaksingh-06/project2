import { getCitiesCache } from "@/lib/config";
import type { Provenance } from "@/lib/zbc/provenance";
import { suggestCities } from "@/lib/utils/spellcheck";
import { canCallGoogle, recordGoogleCall } from "@/lib/providers/google-quota";

export interface GeocodeResult {
  name: string;
  state: string;
  lat: number;
  lng: number;
  resolved_address?: string;       // the exact address/place string the geocoder matched
  provenance: Provenance;          // source of lat/lng coordinates
  name_provenance?: Provenance;    // source of resolved place name
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

// In-memory geocode cache. Batch rows often repeat the same origin/destination
// (e.g. a single warehouse shipping to many stores). Without this, each row
// re-geocodes the same address, hammering Nominatim's 1-req/sec limit and
// causing "could not be resolved" failures on every row after the first.
// Keyed by normalized input; persists for the lifetime of the server process.
const geocodeCache = new Map<string, { result: GeocodeResult | null; suggestions: string[] }>();

// Detects "lat, lng" input like "19.1234, 72.8765"
function parseLatLng(input: string): { lat: number; lng: number } | null {
  const m = input.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

async function reverseGeocodeNominatim(
  lat: number,
  lng: number
): Promise<{ name: string; state: string; name_provenance: Provenance }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ZeroBasedCosting/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {
      name: `${lat},${lng}`,
      state: "India",
      name_provenance: { kind: "estimate", label: "Coordinate string" },
    };
    const data = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        suburb?: string;
        state?: string;
      };
    };
    const addr = data.address ?? {};
    const name =
      addr.city ?? addr.town ?? addr.village ?? addr.suburb ??
      `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const state = addr.state ?? "India";
    return { name, state, name_provenance: { kind: "api", label: "OpenStreetMap Nominatim (reverse)" } };
  } catch {
    return {
      name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      state: "India",
      name_provenance: { kind: "estimate", label: "Coordinate string" },
    };
  }
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
    name_provenance: { kind: "config", label: "City cache" },
  };
}

// ── Google Geocoding API toggle ───────────────────────────────────────────────
// Controlled by GOOGLE_GEOCODE_ENABLED env variable. While off, geocoding falls
// through to the city cache + Nominatim. Enabled when set to "true".
//
// Result of a Google geocode attempt:
//  - "ok": resolved
//  - "blocked": we did NOT (or should not) call Google — monthly cap hit or the
//    API returned OVER_QUERY_LIMIT/429. Callers fall back to OSM and flag it.
//  - "miss": Google ran but found nothing (or is disabled / no key)
type GoogleGeocodeOutcome =
  | { kind: "ok"; result: GeocodeResult }
  | { kind: "blocked" }
  | { kind: "miss" };

async function geocodeGoogle(query: string): Promise<GoogleGeocodeOutcome> {
  if (process.env.GOOGLE_GEOCODE_ENABLED !== "true") return { kind: "miss" };
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { kind: "miss" };

  // Airtight cap: once the monthly free tier is reached, never call Google again.
  if (!canCallGoogle("geocode")) return { kind: "blocked" };

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${query}, India`);
  url.searchParams.set("components", "country:IN");
  url.searchParams.set("key", apiKey);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    // Every dispatched request is billable — count it before inspecting the body.
    recordGoogleCall("geocode");
    if (res.status === 429) return { kind: "blocked" };
    if (!res.ok) {
      console.warn(`[geocode] Google HTTP ${res.status} for "${query}"`);
      return { kind: "miss" };
    }
    const data = (await res.json()) as {
      status: string;
      error_message?: string;
      results: {
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        address_components: { long_name: string; types: string[] }[];
      }[];
    };
    if (data.status === "OVER_QUERY_LIMIT") return { kind: "blocked" };
    if (data.status !== "OK" || !data.results.length) {
      console.warn(
        `[geocode] Google status="${data.status}" for "${query}"` +
          (data.error_message ? ` — ${data.error_message}` : "") +
          (data.status === "REQUEST_DENIED"
            ? " (check: Geocoding API enabled? key has HTTP-referrer restriction?)"
            : "")
      );
      return { kind: "miss" };
    }
    const hit = data.results[0];
    const comps = hit.address_components;

    // Use the most specific resolved name from Google (locality = city, then district,
    // then state) rather than echoing back whatever the user typed. This ensures
    // meta.origin.name / meta.destination.name always shows a clean resolved place name.
    const localityComp =
      comps.find((c) => c.types.includes("locality")) ??
      comps.find((c) => c.types.includes("sublocality_level_1")) ??
      comps.find((c) => c.types.includes("administrative_area_level_2")) ??
      comps.find((c) => c.types.includes("administrative_area_level_1"));

    const stateComp = comps.find((c) =>
      c.types.includes("administrative_area_level_1")
    );

    return {
      kind: "ok",
      result: {
        name: localityComp?.long_name ?? query,
        state: stateComp?.long_name ?? "India",
        lat: hit.geometry.location.lat,
        lng: hit.geometry.location.lng,
        resolved_address: hit.formatted_address,
        provenance: { kind: "api", label: "Google Geocoding" },
        name_provenance: { kind: "api", label: "Google Geocoding" },
      },
    };
  } catch (err) {
    console.warn(`[geocode] Google exception for "${query}":`, err);
    return { kind: "miss" };
  }
}

// Nominatim's usage policy allows at most 1 request/second. This serializes
// and spaces out calls so batch processing doesn't get rate-limited (which
// surfaces as "could not be resolved" on every row after the first).
let nominatimChain: Promise<unknown> = Promise.resolve();
function throttleNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    const result = await fn();
    // Wait 1.1s after the call returns before releasing the next queued caller
    await new Promise((r) => setTimeout(r, 1100));
    return result;
  });
  // Keep the chain alive even if this call throws
  nominatimChain = run.catch(() => undefined);
  return run;
}

export async function geocodeNominatim(
  cityName: string
): Promise<GeocodeResult | null> {
  return throttleNominatim(() => geocodeNominatimRaw(cityName));
}

async function geocodeNominatimRaw(
  cityName: string
): Promise<GeocodeResult | null> {
  const query = encodeURIComponent(`${cityName}, India`);
  // addressdetails=1 makes Nominatim return structured address fields (city, state, etc.)
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=in&addressdetails=1`;
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
      address?: { city?: string; town?: string; village?: string; state?: string };
    }[];
    if (!data.length) return null;
    const hit = data[0];
    const addr = hit.address ?? {};
    const state =
      addr.state ??
      hit.display_name.split(",").slice(-2, -1)[0]?.trim() ??
      "India";
    return {
      name: cityName,
      state,
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      resolved_address: hit.display_name,
      provenance: {
        kind: "api",
        label: "OpenStreetMap Nominatim",
      },
      name_provenance: { kind: "api", label: "OpenStreetMap Nominatim" },
    };
  } catch {
    return null;
  }
}

// Drops the leftmost comma-separated segment so a too-specific prefix (house
// number, floor) can be removed and the rest retried. Returns null when no comma
// remains. "B-45, Ground Floor, Royal Palm, Zirakpur" → "Ground Floor, Royal Palm, Zirakpur"
export function stripLeftmostSegment(address: string): string | null {
  const idx = address.indexOf(",");
  if (idx === -1) return null;
  const rest = address.slice(idx + 1).trim();
  return rest.length > 0 ? rest : null;
}

// Public entry point — adds caching around the actual provider chain so
// repeated addresses within a batch only hit the geocoding APIs once.
export async function geocode(cityName: string): Promise<{
  result: GeocodeResult | null;
  suggestions: string[];
}> {
  const key = normalize(cityName);
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const out = await geocodeUncached(cityName);
  // Only cache successful resolutions — a transient failure (e.g. rate limit)
  // shouldn't be permanently remembered as "unresolvable".
  if (out.result) geocodeCache.set(key, out);
  return out;
}

// Wraps an OSM/cache result to flag that Google was skipped because its monthly
// cap (or live quota) was hit. Surfaces as a red "Fallback" badge in provenance.
function asGoogleFallback(result: GeocodeResult): GeocodeResult {
  return {
    ...result,
    provenance: {
      kind: "error",
      label: "Google limit reached → OSM fallback",
      detail: result.provenance.label,
    },
  };
}

async function geocodeUncached(input: string): Promise<{
  result: GeocodeResult | null;
  suggestions: string[];
}> {
  // ── 1. Explicit coordinates (highest priority) ─────────────────────────────
  // If the input is already a coordinate pair, use it directly. This is the most
  // precise source and never collapses two nearby addresses onto a shared point.
  const latLng = parseLatLng(input);
  if (latLng) {
    const { name, state, name_provenance } = await reverseGeocodeNominatim(latLng.lat, latLng.lng);
    return {
      result: {
        name,
        state,
        lat: latLng.lat,
        lng: latLng.lng,
        provenance: { kind: "input", label: "Provided coordinates" },
        name_provenance,
      },
      suggestions: [],
    };
  }

  // ── 2. Progressive resolve: Google → OSM → city cache, stripping the leftmost
  //       comma segment on failure and retrying the shorter address. ───────────
  // Google is tried first because it resolves full Indian street addresses to the
  // actual location; OSM/Nominatim often returns only a city centroid. If Google
  // is blocked (monthly cap reached), the OSM/cache result is flagged as a fallback.
  let current = input.trim();
  let googleBlocked = false;
  while (current.length > 0) {
    const g = await geocodeGoogle(current);
    if (g.kind === "ok") return { result: g.result, suggestions: [] };
    if (g.kind === "blocked") googleBlocked = true;

    const nominatim = await geocodeNominatim(current);
    if (nominatim) {
      return {
        result: googleBlocked ? asGoogleFallback(nominatim) : nominatim,
        suggestions: [],
      };
    }

    const cached = geocodeFromCache(current);
    if (cached) {
      return {
        result: googleBlocked ? asGoogleFallback(cached) : cached,
        suggestions: [],
      };
    }

    const next = stripLeftmostSegment(current);
    if (next === null) break;
    current = next;
  }

  const suggestions = suggestCities(input, getCitiesCache());
  return { result: null, suggestions };
}
