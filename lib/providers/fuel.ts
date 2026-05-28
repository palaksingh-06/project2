import { getFallbackRates } from "@/lib/config";
import type { Provenance } from "@/lib/zbc/provenance";

export interface FuelPriceResult {
  price_inr: number;
  state: string;
  provenance: Provenance;
}

const CORE_FUEL_URL = "https://energy.thecore.in/api/india-state-prices";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CoreStateEntry {
  name: string;
  diesel: number;
}

interface CoreFuelResponse {
  fetchedAt?: string;
  source?: string;
  states: Record<string, CoreStateEntry>;
}

const STATE_ALIASES: Record<string, string> = {
  chhattisgarh: "chhatisgarh",
  "dadra and nagar haveli": "dadra and nagar haveli and daman and diu",
  "daman and diu": "dadra and nagar haveli and daman and diu",
  "jammu and kashmir": "jammu & kashmir",
  orissa: "odisha",
  pondicherry: "pondicherry",
  "andaman and nicobar": "andaman & nicobar",
  "andaman & nicobar islands": "andaman & nicobar",
};

let priceCache: {
  loadedAt: number;
  fetchedAt?: string;
  feedSource?: string;
  byState: Map<string, { name: string; diesel: number }>;
} | null = null;

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveStateKey(state: string): string {
  const n = normalizeKey(state);
  return STATE_ALIASES[n] ?? n;
}

export function lookupDieselInMap(
  state: string,
  byState: Map<string, { name: string; diesel: number }>
): { name: string; diesel: number } | null {
  const key = resolveStateKey(state);
  if (byState.has(key)) return byState.get(key)!;

  for (const [, entry] of byState) {
    if (normalizeKey(entry.name) === key) return entry;
  }

  for (const [, entry] of byState) {
    const entryKey = normalizeKey(entry.name);
    if (entryKey.includes(key) || key.includes(entryKey)) return entry;
  }

  return null;
}

function buildStateMap(data: CoreFuelResponse): Map<
  string,
  { name: string; diesel: number }
> {
  const map = new Map<string, { name: string; diesel: number }>();
  for (const entry of Object.values(data.states)) {
    if (typeof entry.diesel !== "number" || entry.diesel <= 0) continue;
    map.set(normalizeKey(entry.name), {
      name: entry.name,
      diesel: entry.diesel,
    });
  }
  return map;
}

async function loadCoreFuelPrices(): Promise<{
  byState: Map<string, { name: string; diesel: number }>;
  fetchedAt?: string;
  feedSource?: string;
} | null> {
  if (priceCache && Date.now() - priceCache.loadedAt < CACHE_TTL_MS) {
    return {
      byState: priceCache.byState,
      fetchedAt: priceCache.fetchedAt,
      feedSource: priceCache.feedSource,
    };
  }

  try {
    const res = await fetch(CORE_FUEL_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as CoreFuelResponse;
    if (!data.states || typeof data.states !== "object") return null;

    const byState = buildStateMap(data);
    priceCache = {
      loadedAt: Date.now(),
      fetchedAt: data.fetchedAt,
      feedSource: data.source,
      byState,
    };

    return { byState, fetchedAt: data.fetchedAt, feedSource: data.source };
  } catch {
    return null;
  }
}

function isValidDieselPrice(n: number): boolean {
  return n > 50 && n < 200;
}

export async function getDieselPrice(state: string): Promise<FuelPriceResult> {
  const fallback = getFallbackRates();
  const byStateConfig = fallback.diesel_by_state as Record<string, number>;

  const configKey = Object.keys(byStateConfig).find(
    (k) => k.toLowerCase() === state.toLowerCase()
  );
  const fallbackPrice =
    (configKey ? byStateConfig[configKey] : undefined) ??
    fallback.diesel_national_default_inr;

  const core = await loadCoreFuelPrices();
  if (core) {
    const match = lookupDieselInMap(state, core.byState);
    if (match && isValidDieselPrice(match.diesel)) {
      return {
        price_inr: match.diesel,
        state: match.name,
        provenance: {
          kind: "api",
          label: "The Core Fuel Watch",
          detail: core.feedSource ?? "energy.thecore.in/api/india-state-prices",
          updated_at: core.fetchedAt,
        },
      };
    }
  }

  return {
    price_inr: fallbackPrice,
    state: configKey ?? state,
    provenance: {
      kind: "config",
      label: "Diesel fallback",
      detail: "config/fallback-rates.json (API feed unavailable)",
    },
  };
}

export function clearFuelPriceCache(): void {
  priceCache = null;
}
