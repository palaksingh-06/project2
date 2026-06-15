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
): Promise<{ name: string; state: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ZeroBasedCosting/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { name: `${lat},${lng}`, state: "India" };
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
    return { name, state };
  } catch {
    return { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, state: "India" };
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
  };
}

// ── Google Geocoding API toggle ───────────────────────────────────────────────
// Controlled by GOOGLE_GEOCODE_ENABLED env variable. While off, geocoding falls
// through to the city cache + Nominatim. Enabled when set to "true".
async function geocodeGoogle(cityName: string): Promise<GeocodeResult | null> {
  if (process.env.GOOGLE_GEOCODE_ENABLED !== "true") return null;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${cityName}, India`);
  url.searchParams.set("components", "country:IN");
  url.searchParams.set("key", apiKey);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[geocode] Google HTTP ${res.status} for "${cityName}"`);
      return null;
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
    if (data.status !== "OK" || !data.results.length) {
      console.warn(
        `[geocode] Google status="${data.status}" for "${cityName}"` +
          (data.error_message ? ` — ${data.error_message}` : "") +
          (data.status === "REQUEST_DENIED"
            ? " (check: Geocoding API enabled? key has HTTP-referrer restriction?)"
            : "")
      );
      return null;
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
      name: localityComp?.long_name ?? cityName,
      state: stateComp?.long_name ?? "India",
      lat: hit.geometry.location.lat,
      lng: hit.geometry.location.lng,
      provenance: { kind: "api", label: "Google Geocoding" },
    };
  } catch (err) {
    console.warn(`[geocode] Google exception for "${cityName}":`, err);
    return null;
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
      provenance: {
        kind: "api",
        label: "OpenStreetMap Nominatim",
      },
    };
  } catch {
    return null;
  }
}

// Extracts city-like candidates from a full street address, in priority order.
// For "SCO-101, Ground Floor, Nabha Gate, New Leela Bhawan Market, Patiala, Punjab 147001"
// this returns ["Punjab", "Patiala", "New Leela Bhawan Market", ...]
// The caller tries each against the city cache; first hit wins.
function extractCityCandidates(address: string): string[] {
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];

  const candidates: string[] = [];
  // Walk from the end — city/state/pincode are usually last
  for (const part of [...parts].reverse()) {
    const clean = part
      .replace(/\b\d{6}\b/g, "")   // strip 6-digit pincodes
      .replace(/\b\d+\b/g, "")     // strip stray numbers
      .replace(/\b(ground floor|first floor|second floor|upper ground|floor|shop no\.?|kiosk|sco|scf|block|sector|phase|unit|no\.?|plot|near|opp\.?|opposite)\b/gi, "")
      .replace(/[-]/g, " ")
      .trim();
    if (clean.length >= 3 && /[a-zA-Z]/.test(clean)) {
      candidates.push(clean);
    }
  }
  return candidates;
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

async function geocodeUncached(cityName: string): Promise<{
  result: GeocodeResult | null;
  suggestions: string[];
}> {
  // ── 1. lat/lng coordinates (HIGHEST PRIORITY) ──────────────────────────────
  // If the input is already a coordinate pair, use it directly. This is the most
  // precise source and never collapses two nearby addresses onto a shared point.
  const latLng = parseLatLng(cityName);
  if (latLng) {
    const { name, state } = await reverseGeocodeNominatim(latLng.lat, latLng.lng);
    return {
      result: {
        name,
        state,
        lat: latLng.lat,
        lng: latLng.lng,
        provenance: { kind: "api", label: "Coordinates (lat/lng)" },
      },
      suggestions: [],
    };
  }

  // ── 2. OSM / Nominatim (precise per-address) ───────────────────────────────
  // Tried before the city cache because OSM returns the actual address location,
  // whereas the cache only has city centroids — which would make two outlets in
  // the same city resolve to identical coordinates (0 km distance between them).
  const nominatim = await geocodeNominatim(cityName);
  if (nominatim) return { result: nominatim, suggestions: [] };

  // ── 3. City cache (coarse centroid fallback) ───────────────────────────────
  // Only reached if OSM couldn't resolve the address. Returns a city-level
  // centroid, so it's a last-resort approximation.
  const cached = geocodeFromCache(cityName);
  if (cached) return { result: cached, suggestions: [] };

  // ── 4. Google Maps (currently disabled — returns null) ─────────────────────
  const google = await geocodeGoogle(cityName);
  if (google) return { result: google, suggestions: [] };

  // ── 5. City extraction fallback (for full street addresses) ────────────────
  // When OSM couldn't resolve a full address, extract candidate city names from
  // the end (e.g. "Nabha Gate, Patiala, Punjab 147001" → "Punjab", then
  // "Patiala") and retry each against OSM, then the cache.
  if (cityName.includes(",")) {
    for (const candidate of extractCityCandidates(cityName)) {
      const nomCity = await geocodeNominatim(candidate);
      if (nomCity) return { result: nomCity, suggestions: [] };
      const cachedCity = geocodeFromCache(candidate);
      if (cachedCity) return { result: cachedCity, suggestions: [] };
    }
  }

  const suggestions = suggestCities(cityName, getCitiesCache());
  return { result: null, suggestions };
}
