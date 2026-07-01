import masterData from "@/config/return-load-master.json";

export interface ReturnLoadInfo {
  multiplier: number;
  hub: string;
  terrain: string;
  return_probability_pct: number;
  empty_haul_pct: number;
  reason: string;
  matched_city: string;
  matched_state: string;
  match_level: "city" | "state";
}

interface MasterCity {
  city: string;
  city_key: string;
  state: string;
  state_key: string;
  return_probability_pct: number;
  empty_haul_pct: number;
  multiplier: number;
  terrain: string;
  hub: string;
  reason: string;
}

const CITIES = masterData.cities as MasterCity[];

// Precompute state-level averages at module load — used as fallback when a
// city is not individually present in the master.
interface StateAverage {
  state: string;
  state_key: string;
  multiplier: number;
  return_probability_pct: number;
  empty_haul_pct: number;
  terrain: string;
  hub: string;
  city_count: number;
}

function mode<T>(arr: T[]): T {
  const freq = new Map<T, number>();
  for (const v of arr) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

const STATE_AVERAGES: Map<string, StateAverage> = (() => {
  const grouped = new Map<string, MasterCity[]>();
  for (const c of CITIES) {
    const bucket = grouped.get(c.state_key) ?? [];
    bucket.push(c);
    grouped.set(c.state_key, bucket);
  }
  const result = new Map<string, StateAverage>();
  for (const [stateKey, cities] of grouped) {
    const avg = (fn: (c: MasterCity) => number) =>
      cities.reduce((s, c) => s + fn(c), 0) / cities.length;
    result.set(stateKey, {
      state: cities[0].state,
      state_key: stateKey,
      multiplier: Math.round(avg((c) => c.multiplier) * 100) / 100,
      return_probability_pct: Math.round(avg((c) => c.return_probability_pct) * 10) / 10,
      empty_haul_pct: Math.round(avg((c) => c.empty_haul_pct)),
      terrain: mode(cities.map((c) => c.terrain)),
      hub: mode(cities.map((c) => c.hub)),
      city_count: cities.length,
    });
  }
  return result;
})();

// Strip everything from the first comma onward (geocoder often returns
// "Patiala, Punjab 147001" — we only want "Patiala"), then lowercase/trim.
function normalizeName(name: string): string {
  return name.split(",")[0].toLowerCase().trim();
}

function normalizeState(state: string): string {
  return state.toLowerCase().trim();
}

export function lookupReturnLoad(
  cityName: string,
  stateName?: string
): ReturnLoadInfo | null {
  const normCity = normalizeName(cityName);
  const normState = stateName ? normalizeState(stateName) : null;

  // 1. Exact city + state match (preferred when state is available)
  if (normState) {
    const exact = CITIES.find(
      (c) => c.city_key === normCity && c.state_key === normState
    );
    if (exact) return toInfo(exact);
  }

  // 2. Exact city name only — works when state is absent or doesn't match
  const byCity = CITIES.filter((c) => c.city_key === normCity);
  if (byCity.length === 1) return toInfo(byCity[0]);
  if (byCity.length > 1) {
    // Multiple cities with same name (e.g. Bilaspur, Udaipur):
    // prefer the one whose state_key partially matches what we have
    if (normState) {
      const stateMatch = byCity.find((c) => c.state_key.includes(normState) || normState.includes(c.state_key));
      if (stateMatch) return toInfo(stateMatch);
    }
    // Fall back to highest return probability (most active logistics market)
    return toInfo(byCity.reduce((a, b) => a.return_probability_pct >= b.return_probability_pct ? a : b));
  }

  // 3. Partial match: the geocoded name may include extra words
  // e.g. "Navi Mumbai" should match "Navi Mumbai", "Greater Noida" → "Noida"
  const tokens = normCity.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length > 0) {
    const candidates = CITIES.filter((c) =>
      tokens.every((t) => c.city_key.includes(t))
    );
    if (candidates.length === 1) return toInfo(candidates[0]);
    if (candidates.length > 1 && normState) {
      const stateMatch = candidates.find((c) => c.state_key === normState);
      if (stateMatch) return toInfo(stateMatch);
      return toInfo(candidates[0]);
    }
  }

  // 4. State-level fallback — city not in master but state is known
  if (normState) {
    const stateAvg = STATE_AVERAGES.get(normState);
    if (stateAvg) return toStateInfo(stateAvg, cityName);
  }

  return null;
}

function toInfo(c: MasterCity): ReturnLoadInfo {
  return {
    multiplier: c.multiplier,
    hub: c.hub,
    terrain: c.terrain,
    return_probability_pct: c.return_probability_pct,
    empty_haul_pct: c.empty_haul_pct,
    reason: c.reason,
    matched_city: c.city,
    matched_state: c.state,
    match_level: "city",
  };
}

function toStateInfo(s: StateAverage, queriedCity: string): ReturnLoadInfo {
  return {
    multiplier: s.multiplier,
    hub: s.hub,
    terrain: s.terrain,
    return_probability_pct: s.return_probability_pct,
    empty_haul_pct: s.empty_haul_pct,
    reason: `State-level average for ${s.state} (${queriedCity} not in master; averaged across ${s.city_count} cities).`,
    matched_city: `${s.state} (state avg)`,
    matched_state: s.state,
    match_level: "state",
  };
}
