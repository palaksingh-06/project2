import citiesCache from "@/config/cities-cache.json";
import fallbackRates from "@/config/fallback-rates.json";
import truckModels from "@/config/truck-models.json";
import truckRates from "@/config/truck-rates.json";
import truckAliases from "@/config/truck-aliases.json";
import zbcGuidelines from "@/config/zbc-guidelines.json";
import type { TruckProfile, TruckRatesConfig } from "@/lib/zbc/types";

export interface SourcedValue {
  value: number;
  source: "real" | "proxy" | "estimate";
}

export interface TruckModel {
  label: string;
  truck_class: string;
  payload_tons: number;
  image: string | null;
  mileage_kmpl: SourcedValue;
  ex_showroom_inr: SourcedValue;
}

export function getTruckRatesConfig(): TruckRatesConfig {
  return truckRates as TruckRatesConfig;
}

export function getTruckProfile(truckId: string): TruckProfile | null {
  const config = getTruckRatesConfig();
  return config.trucks[truckId] ?? null;
}

export function getTruckOptions(): { id: string; label: string }[] {
  const config = getTruckRatesConfig();
  return Object.entries(config.trucks).map(([id, t]) => ({
    id,
    label: t.label,
  }));
}

export function getTrucksByBodyType(
  bodyType: "open" | "closed"
): { id: string; label: string; payload_tons: number; length_ft: number; axles: number }[] {
  const config = getTruckRatesConfig();
  return Object.entries(config.trucks)
    .filter(([, t]) => t.body_type === bodyType)
    .map(([id, t]) => ({
      id,
      label: t.label,
      payload_tons: t.payload_tons,
      length_ft: t.length_ft,
      axles: t.axles,
    }));
}

export function getFallbackRates() {
  return fallbackRates;
}

export function getCitiesCache() {
  return citiesCache.cities;
}

export function getTruckModels(): Record<string, TruckModel> {
  return truckModels.models as Record<string, TruckModel>;
}

export function getTruckModel(modelId: string): TruckModel | null {
  return (truckModels.models as Record<string, TruckModel>)[modelId] ?? null;
}

// Returns the editable alias map: human-friendly keyword → model ID or truck-class ID.
// Used to resolve freeform truck_model_id text like "Bolero-Pickup" or "Intra".
export function getTruckAliases(): Record<string, string> {
  return truckAliases.aliases as Record<string, string>;
}

export interface ZbcGuidelines {
  placement_hrs: number;
  plant_turnaround_hrs: number;
  client_turnaround_hrs: number;
  return_to_garage_hrs: number;
  rest_threshold_km: number;
  rest_hrs: number;
  return_load_wait_hrs: number;
  uptime_pct: number;
  overhead_pct: number;
  profit_pct: number;
}

export function getZbcGuidelines(): ZbcGuidelines {
  return zbcGuidelines as ZbcGuidelines;
}

// Looks up the ₹/km usage-depreciation multiplier for a terrain type. Defaults
// to 1.0 (Plain) for unknown/missing terrain so calculation never throws.
export function getTerrainDepreciationMultiplier(terrain?: string): number {
  const rates = getFallbackRates() as {
    terrain_depreciation_multiplier?: Record<string, number>;
  };
  return rates.terrain_depreciation_multiplier?.[terrain ?? "Plain"] ?? 1.0;
}
