import citiesCache from "@/config/cities-cache.json";
import fallbackRates from "@/config/fallback-rates.json";
import truckModels from "@/config/truck-models.json";
import truckRates from "@/config/truck-rates.json";
import type { TruckProfile, TruckRatesConfig } from "@/lib/zbc/types";

export interface TruckModel {
  label: string;
  truck_class: string;
  mileage_kmpl: number;
  payload_tons: number;
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
