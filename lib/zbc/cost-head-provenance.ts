import type { CostHeadId, RateOverrides } from "@/lib/zbc/types";
import type { Provenance } from "@/lib/zbc/provenance";

const TRUCK_CONFIG: Provenance = {
  kind: "config",
  label: "Truck rates",
  detail: "config/truck-rates.json",
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

  return {
    driver: withOverride(TRUCK_CONFIG, overrides, [
      "driver_per_day",
      "bata_per_trip",
      "night_halt_per_night",
    ]),
    vehicle: withOverride(TRUCK_CONFIG, overrides, ["depreciation_per_km", "vehicle_per_trip"]),
    toll: withOverride(
      {
        kind: toll.kind,
        label: "Tolls + permit",
        detail: `${toll.label}${toll.detail ? ` — ${toll.detail}` : ""}`,
      },
      overrides,
      ["state_permit"]
    ),
    maintenance: withOverride(TRUCK_CONFIG, overrides, ["maintenance_per_km"]),
    loading: withOverride(TRUCK_CONFIG, overrides, ["loading_per_ton"]),
    idle: withOverride(TRUCK_CONFIG, overrides, [
      "idle_hours",
      "idle_cost_per_hour",
    ]),
    overhead: withOverride(TRUCK_CONFIG, overrides, ["overhead_per_trip"]),
    risk: withOverride(
      {
        kind: "config",
        label: "Risk buffer %",
        detail: "config/truck-rates.json",
      },
      overrides,
      ["risk_pct"]
    ),
    empty_return: withOverride(TRUCK_CONFIG, overrides, [
      "empty_return_pct",
      "empty_km",
    ]),
  };
}
