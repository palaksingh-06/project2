import type { Provenance } from "@/lib/zbc/provenance";
import type { ZbcGuidelines } from "@/lib/config";

export type { ZbcGuidelines };

/** @deprecated Use Provenance — kept for internal provider returns */
export type DataSource = "live" | "fallback";
export interface ContributionRange {
  min: number;
  max: number;
}

export interface TyreProfile {
  count: number;
  cost_per_tyre: number;
  life_km: number;
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

  // ── Driver & crew (days-based fixed allocation) ──────────────────────────
  driver_per_day: number;
  bata_per_trip: number;
  night_halt_per_night: number;
  /** Off by default — only produces a cost line when > 0. */
  helper_per_day?: number;

  // ── Variable costs ────────────────────────────────────────────────────────
  maintenance_per_km: number;
  tyres: TyreProfile;

  // ── Depreciation (split: aging = annual-km fixed, usage = variable) ─────
  ex_showroom_inr: number;
  salvage_pct: number;
  life_years: number;
  life_km: number;
  depreciation_aging_share: number;
  depreciation_usage_share: number;

  // ── Other fixed costs (annual-km allocation — Unnati method) ─────────────
  insurance_per_year: number;
  road_tax_per_year: number;
  fitness_per_year: number;
  interest_per_year: number;

  // ── Optional fixed add-ons (off by default; only costed when > 0) ───────
  gps_per_year?: number;
  fastag_fee_per_year?: number;
  rto_misc_per_year?: number;
  tarpaulin_per_year?: number;
  other_fixed_per_year?: number;

  loading_per_ton: number;
  empty_return_pct: number;
}

export interface TruckRatesConfig {
  avg_speed_kmh: number;
  contribution_ranges: Record<string, ContributionRange>;
  trucks: Record<string, TruckProfile>;
}

export interface RateOverrides {
  distance_km?: number;
  mileage_kmpl?: number;

  driver_per_day?: number;
  bata_per_trip?: number;
  night_halt_per_night?: number;
  helper_per_day?: number;

  maintenance_per_km?: number;
  tyres_count?: number;
  tyres_cost_per_tyre?: number;
  tyres_life_km?: number;

  ex_showroom_inr?: number;
  salvage_pct?: number;
  life_years?: number;
  life_km?: number;
  depreciation_aging_share?: number;
  depreciation_usage_share?: number;

  insurance_per_year?: number;
  road_tax_per_year?: number;
  fitness_per_year?: number;
  interest_per_year?: number;

  gps_per_year?: number;
  fastag_fee_per_year?: number;
  rto_misc_per_year?: number;
  tarpaulin_per_year?: number;
  other_fixed_per_year?: number;

  loading_per_ton?: number;
  empty_return_pct?: number;
  empty_km?: number;
  state_permit?: number;

  overhead_pct?: number;
  profit_pct?: number;
  terrain?: "Plain" | "Hill";
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
  /** Utilization/overhead/profit constants — see lib/config.ts#getZbcGuidelines(). */
  guidelines: ZbcGuidelines;
  /** Destination terrain, used for the usage-depreciation multiplier. Defaults to "Plain". */
  terrain?: "Plain" | "Hill";
  /** Cost head IDs to fully omit from this calculation (Configuration tab toggles). */
  excluded_heads?: CostHeadId[];
}

export type CostHeadId =
  | "fuel"
  | "driver"
  | "helper"
  | "maintenance"
  | "tyres"
  | "depreciation_usage"
  | "depreciation_aging"
  | "insurance"
  | "road_tax"
  | "fitness"
  | "interest"
  | "gps"
  | "fastag_fee"
  | "rto_misc"
  | "tarpaulin"
  | "other_fixed"
  | "toll"
  | "loading"
  | "empty_return"
  | "overhead"
  | "profit";

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
