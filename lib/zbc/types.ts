import type { Provenance } from "@/lib/zbc/provenance";

/** @deprecated Use Provenance — kept for internal provider returns */
export type DataSource = "live" | "fallback";
export interface ContributionRange {
  min: number;
  max: number;
}

export interface TruckProfile {
  label: string;
  body_type: "open" | "closed";
  length_ft: number;
  axles: number;
  payload_tons: number;
  wheels: number;
  toll_class: string;
  mileage_kmpl: number;
  mileage_kmpl_considered: number;
  driver_per_day: number;
  bata_per_trip: number;
  night_halt_per_night: number;
  depreciation_per_km: number;
  maintenance_per_km: number;
  loading_per_ton: number;
  idle_hours_short_haul: number;   // < 300 km
  idle_hours_medium_haul: number;  // 300–800 km
  idle_hours_long_haul: number;    // > 800 km
  idle_cost_per_hour: number;
  overhead_per_trip: number;
  risk_pct: number;
  empty_return_pct: number;
}

export interface TruckRatesConfig {
  avg_speed_kmh: number;
  contribution_ranges: Record<string, ContributionRange>;
  trucks: Record<string, TruckProfile>;
}

export interface RateOverrides {
  mileage_kmpl?: number;
  driver_per_day?: number;
  bata_per_trip?: number;
  night_halt_per_night?: number;
  depreciation_per_km?: number;
  vehicle_per_trip?: number;
  state_permit?: number;
  maintenance_per_km?: number;
  loading_per_ton?: number;
  idle_hours?: number;
  idle_cost_per_hour?: number;
  overhead_per_trip?: number;
  risk_pct?: number;
  empty_return_pct?: number;
  empty_km?: number;
}

export interface RouteData {
  distance_km: number;
  distance_source: DataSource;
  origin: { name: string; state: string; lat: number; lng: number };
  destination: { name: string; state: string; lat: number; lng: number };
}

export interface TollData {
  total_inr: number;
  plaza_count: number;
  provenance: Provenance;
  highway?: string;
}

export interface FuelData {
  price_inr: number;
  state: string;
  provenance: Provenance;
}

export interface CalculateInput {
  truckId: string;
  profile: TruckProfile;
  payloadTons: number;
  distance_km: number;
  days: number;
  diesel_price_inr: number;
  toll: TollData;
  overrides?: RateOverrides;
  avg_speed_kmh: number;
  trip_type: string;
}

export type CostHeadId =
  | "fuel"
  | "driver"
  | "vehicle"
  | "toll"
  | "maintenance"
  | "loading"
  | "idle"
  | "overhead"
  | "risk"
  | "empty_return";

export interface CostLine {
  id: CostHeadId;
  sno: number;
  name: string;
  formula: string;
  amount_inr: number;
  inputs: Record<string, string | number>;
}

export interface CalculateResult {
  lines: CostLine[];
  subtotal_inr: number;
  total_inr: number;
  trip_days: number;
}

export type ContributionStatus = "ok" | "low" | "high";

export interface ContributionCheck {
  id: CostHeadId;
  name: string;
  pct: number;
  range: ContributionRange;
  status: ContributionStatus;
}
