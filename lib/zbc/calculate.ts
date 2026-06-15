import type {
  CalculateInput,
  CalculateResult,
  CostLine,
  TruckProfile,
} from "@/lib/zbc/types";

export function tripDays(distance_km: number, avg_speed_kmh: number): number {
  return Math.max(1, Math.ceil(distance_km / avg_speed_kmh / 24));
}

function defaultIdleHours(profile: TruckProfile, distance_km: number): number {
  if (distance_km < 300) return profile.idle_hours_short_haul;
  if (distance_km < 800) return profile.idle_hours_medium_haul;
  return profile.idle_hours_long_haul;
}

export function calculateZBC(input: CalculateInput): CalculateResult {
  const {
    profile: baseProfile,
    payloadTons,
    distance_km,
    days,
    diesel_price_inr,
    toll,
    overrides,
    is_round_trip,
  } = input;

  const profile = { ...baseProfile, ...overrides };

  // Fuel
  const mileage = overrides?.mileage_kmpl ?? profile.mileage_kmpl_considered;
  const dieselLitresConsumed = distance_km / mileage;
  const fuelCostInr = dieselLitresConsumed * diesel_price_inr;
  const fuelCostPerKm = distance_km > 0 ? fuelCostInr / distance_km : 0;

  // Driver & crew
  const driverCrewCostInr =
    (overrides?.driver_per_day ?? profile.driver_per_day) * days +
    (overrides?.bata_per_trip ?? profile.bata_per_trip) +
    (overrides?.night_halt_per_night ?? profile.night_halt_per_night) *
      Math.max(0, days - 1);

  // Vehicle depreciation — flat hire charge overrides per-km if provided
  const depreciationPerKm =
    overrides?.depreciation_per_km ?? profile.depreciation_per_km;
  const depreciationCostInr = overrides?.vehicle_per_trip
    ? overrides.vehicle_per_trip
    : depreciationPerKm * distance_km;

  // Toll + state permit
  const tollAndPermitCostInr = toll.total_inr + (overrides?.state_permit ?? 0);

  // Maintenance
  const maintenanceCostPerKm =
    overrides?.maintenance_per_km ?? profile.maintenance_per_km;
  const maintenanceCostInr = maintenanceCostPerKm * distance_km;

  // Loading
  const loadingCostInr =
    (overrides?.loading_per_ton ?? profile.loading_per_ton) * payloadTons;

  // Idle / waiting
  const idleWaitingHours =
    overrides?.idle_hours ?? defaultIdleHours(baseProfile, distance_km);
  const idleWaitingCostInr =
    idleWaitingHours *
    (overrides?.idle_cost_per_hour ?? profile.idle_cost_per_hour);

  // Overheads
  const overheadCostInr =
    overrides?.overhead_per_trip ?? profile.overhead_per_trip;

  // Empty return
  const emptyReturnFraction = !is_round_trip ? 0 :
    overrides?.empty_return_pct ?? profile.empty_return_pct;
  const emptyReturnDistanceKm = overrides?.empty_km ?? distance_km * emptyReturnFraction;
  const effectiveDepreciationPerKm =
    distance_km > 0 ? depreciationCostInr / distance_km : depreciationPerKm;
  const variableCostPerKm =
    fuelCostPerKm + maintenanceCostPerKm + effectiveDepreciationPerKm;
    
  const emptyReturnCostInr = emptyReturnDistanceKm * variableCostPerKm;

  const linesBeforeRisk: CostLine[] = [
    {
      sno: 1,
      id: "fuel",
      name: "Fuel Cost",
      formula: "(Distance ÷ Mileage) × Fuel price",
      amount_inr: round(fuelCostInr),
      inputs: {
        distance_km,
        mileage_kmpl: mileage,
        diesel_inr: diesel_price_inr,
        liters: round(dieselLitresConsumed, 1),
      },
    },
    {
      sno: 2,
      id: "driver",
      name: "Driver & Crew",
      formula: "Per trip / per day",
      amount_inr: round(driverCrewCostInr),
      inputs: {
        days,
        driver_per_day: overrides?.driver_per_day ?? profile.driver_per_day,
        bata_per_trip: overrides?.bata_per_trip ?? profile.bata_per_trip,
        night_halt_per_night: overrides?.night_halt_per_night ?? profile.night_halt_per_night,
      },
    },
    {
      sno: 3,
      id: "vehicle",
      name: "Vehicle Cost",
      formula: overrides?.vehicle_per_trip ? "Hire charge per trip" : "₹/km × distance",
      amount_inr: round(depreciationCostInr),
      inputs: {
        depreciation_per_km: depreciationPerKm,
        distance_km,
      },
    },
    {
      sno: 4,
      id: "toll",
      name: "Toll & Permits",
      formula: "Actual route cost + state permit",
      amount_inr: round(tollAndPermitCostInr),
      inputs: {
        toll_api: toll.total_inr,
        permit: overrides?.state_permit ?? 0,
        plazas: toll.plaza_count,
        distance_km,
      },
    },
    {
      sno: 5,
      id: "maintenance",
      name: "Maintenance & Tyres",
      formula: "₹/km basis",
      amount_inr: round(maintenanceCostInr),
      inputs: { per_km: maintenanceCostPerKm, distance_km },
    },
    {
      sno: 6,
      id: "loading",
      name: "Loading & Unloading",
      formula: "₹/ton × payload",
      amount_inr: round(loadingCostInr),
      inputs: {
        payload_tons: payloadTons,
        per_ton: overrides?.loading_per_ton ?? profile.loading_per_ton,
      },
    },
    {
      sno: 7,
      id: "idle",
      name: "Idle / Waiting Cost",
      formula: "Time × cost/hour",
      amount_inr: round(idleWaitingCostInr),
      inputs: {
        hours: idleWaitingHours,
        per_hour: profile.idle_cost_per_hour,
      },
    },
    {
      sno: 8,
      id: "overhead",
      name: "Overheads",
      formula: "Allocated per trip",
      amount_inr: round(overheadCostInr),
      inputs: { per_trip: overheadCostInr },
    },
    {
      sno: 10,
      id: "empty_return",
      name: "Empty Return (Backhaul)",
      formula: "% of empty distance × variable ₹/km",
      amount_inr: round(emptyReturnCostInr),
      inputs: {
        empty_km: round(emptyReturnDistanceKm, 0),
        empty_pct: emptyReturnFraction,
        variable_per_km: round(variableCostPerKm, 2),
      },
    },
  ];

  const subtotal = linesBeforeRisk.reduce((s, l) => s + l.amount_inr, 0);
  const riskFraction = overrides?.risk_pct ?? profile.risk_pct;
  const riskCostInr = subtotal * riskFraction;

  const riskLine: CostLine = {
    sno: 9,
    id: "risk",
    name: "Risk & Variability",
    formula: "% of subtotal",
    amount_inr: round(riskCostInr),
    inputs: { subtotal_inr: subtotal, risk_pct: riskFraction },
  };

  const lines: CostLine[] = [
    ...linesBeforeRisk.slice(0, 8),
    riskLine,
    linesBeforeRisk[8],
  ].map((l, i) => ({ ...l, sno: i + 1 }));

  const total = subtotal + riskCostInr;

  return {
    lines,
    subtotal_inr: subtotal,
    total_inr: round(total),
    trip_days: days,
  };
}

function round(n: number, decimals = 0): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
