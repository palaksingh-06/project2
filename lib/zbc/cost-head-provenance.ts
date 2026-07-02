import type { CostHeadId, RateOverrides } from "@/lib/zbc/types";
import type { Provenance } from "@/lib/zbc/provenance";

const TRUCK_CONFIG: Provenance = {
  kind: "config",
  label: "Truck rates",
  detail: "config/truck-rates.json",
};

const GUIDELINES_CONFIG: Provenance = {
  kind: "config",
  label: "ZBC guidelines",
  detail: "config/zbc-guidelines.json",
};

const USER_OVERRIDE: Provenance = {
  kind: "input",
  label: "User override",
  detail: "Advanced rates form",
};

function withOverride(
  base: Provenance,
  overrides: RateOverrides | undefined,
  keys: (keyof RateOverrides)[]
): Provenance {
  if (!overrides) return base;
  if (keys.some((k) => overrides[k] !== undefined)) {
    return {
      ...USER_OVERRIDE,
      detail: `Overrides ${keys.join(", ")}; base: ${base.detail ?? base.label}`,
    };
  }
  return base;
}

export function buildCostHeadProvenance(input: {
  toll: Provenance;
  overrides?: RateOverrides;
}): Omit<Record<CostHeadId, Provenance>, "fuel"> {
  const { toll, overrides } = input;

  const depreciationKeys: (keyof RateOverrides)[] = [
    "ex_showroom_inr", "salvage_pct", "life_years", "life_km",
    "depreciation_aging_share", "depreciation_usage_share",
  ];

  return {
    driver: withOverride(TRUCK_CONFIG, overrides, ["driver_per_day", "bata_per_trip", "night_halt_per_night"]),
    helper: withOverride(TRUCK_CONFIG, overrides, ["helper_per_day"]),
    maintenance: withOverride(TRUCK_CONFIG, overrides, ["maintenance_per_km"]),
    tyres: withOverride(TRUCK_CONFIG, overrides, ["tyres_count", "tyres_cost_per_tyre", "tyres_life_km"]),
    depreciation_usage: withOverride(TRUCK_CONFIG, overrides, depreciationKeys),
    depreciation_aging: withOverride(TRUCK_CONFIG, overrides, depreciationKeys),
    insurance: withOverride(TRUCK_CONFIG, overrides, ["insurance_per_year"]),
    road_tax: withOverride(TRUCK_CONFIG, overrides, ["road_tax_per_year"]),
    fitness: withOverride(TRUCK_CONFIG, overrides, ["fitness_per_year"]),
    interest: withOverride(TRUCK_CONFIG, overrides, ["interest_per_year"]),
    gps: withOverride(TRUCK_CONFIG, overrides, ["gps_per_year"]),
    fastag_fee: withOverride(TRUCK_CONFIG, overrides, ["fastag_fee_per_year"]),
    rto_misc: withOverride(TRUCK_CONFIG, overrides, ["rto_misc_per_year"]),
    tarpaulin: withOverride(TRUCK_CONFIG, overrides, ["tarpaulin_per_year"]),
    other_fixed: withOverride(TRUCK_CONFIG, overrides, ["other_fixed_per_year"]),
    toll: withOverride(
      { kind: toll.kind, label: "Tolls + permit", detail: `${toll.label}${toll.detail ? ` — ${toll.detail}` : ""}` },
      overrides,
      ["state_permit"]
    ),
    loading: withOverride(TRUCK_CONFIG, overrides, ["loading_per_ton"]),
    empty_return: withOverride(TRUCK_CONFIG, overrides, ["empty_return_pct", "empty_km"]),
    overhead: withOverride(GUIDELINES_CONFIG, overrides, ["overhead_pct"]),
    profit: withOverride(GUIDELINES_CONFIG, overrides, ["profit_pct"]),
  };
}
