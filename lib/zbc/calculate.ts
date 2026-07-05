import type {
  CalculateInput,
  CalculateResult,
  CostLine,
  CostHeadId,
  RateOverrides,
  TruckProfile,
} from "@/lib/zbc/types";
import { estimateAnnualKm } from "@/lib/zbc/utilization";
import { getTerrainDepreciationMultiplier } from "@/lib/config";

export function tripDays(distance_km: number, avg_speed_kmh: number): number {
  return Math.max(1, Math.ceil(distance_km / avg_speed_kmh / 24));
}

// Resolves a single overridable numeric field: override value if present,
// else the truck profile's own value.
function resolve<K extends keyof TruckProfile & keyof RateOverrides>(
  profile: TruckProfile,
  overrides: RateOverrides | undefined,
  key: K
): NonNullable<TruckProfile[K]> {
  const o = overrides?.[key];
  return (o ?? profile[key]) as NonNullable<TruckProfile[K]>;
}

export function calculateZBC(input: CalculateInput): CalculateResult {
  const {
    profile,
    payloadTons,
    distance_km,
    days,
    diesel_price_inr,
    toll,
    overrides,
    trip_type,
    avg_speed_kmh,
    guidelines,
    terrain,
  } = input;

  // Set up exclusion tracking: excluded heads are zeroed at cost calculation
  // time, so all downstream uses (overhead/profit base, backhaulVariablePerKm)
  // automatically reflect the exclusion.
  const excluded = new Set(input.excluded_heads ?? []);
  const isExcluded = (id: CostHeadId) => excluded.has(id);

  // ── Fuel (variable) ────────────────────────────────────────────────────────
  const mileage = overrides?.mileage_kmpl ?? profile.mileage_kmpl_considered;
  const fuelCostInr = distance_km > 0 ? (distance_km / mileage) * diesel_price_inr : 0;
  const fuelPerKm = distance_km > 0 ? fuelCostInr / distance_km : 0;

  // ── Driver & helper (days-based fixed allocation) ─────────────────────────
  const driverPerDay = resolve(profile, overrides, "driver_per_day");
  const bataPerTrip = resolve(profile, overrides, "bata_per_trip");
  const nightHaltPerNight = resolve(profile, overrides, "night_halt_per_night");
  const driverCostInr = isExcluded("driver") ? 0 :
    driverPerDay * days + bataPerTrip + nightHaltPerNight * Math.max(0, days - 1);

  const helperPerDay = overrides?.helper_per_day ?? profile.helper_per_day ?? 0;
  const helperCostInr = isExcluded("helper") ? 0 : helperPerDay * days;

  // ── Maintenance (variable) ─────────────────────────────────────────────────
  const maintenancePerKm = resolve(profile, overrides, "maintenance_per_km");
  const maintenanceCostInr = isExcluded("maintenance") ? 0 : maintenancePerKm * distance_km;

  // ── Tyres (variable) ────────────────────────────────────────────────────────
  const tyresCount = overrides?.tyres_count ?? profile.tyres.count;
  const tyresCostPerTyre = overrides?.tyres_cost_per_tyre ?? profile.tyres.cost_per_tyre;
  const tyresLifeKm = overrides?.tyres_life_km ?? profile.tyres.life_km;
  const tyresPerKm = (tyresCount * tyresCostPerTyre) / tyresLifeKm;
  const tyresCostInr = isExcluded("tyres") ? 0 : tyresPerKm * distance_km;

  // ── Depreciation split: usage (variable, terrain-scaled) ───────────────────
  const exShowroomInr = resolve(profile, overrides, "ex_showroom_inr");
  const salvagePct = resolve(profile, overrides, "salvage_pct");
  const lifeYears = resolve(profile, overrides, "life_years");
  const lifeKm = resolve(profile, overrides, "life_km");
  const agingShare = resolve(profile, overrides, "depreciation_aging_share");
  const usageShare = resolve(profile, overrides, "depreciation_usage_share");

  const depreciableBase = exShowroomInr * (1 - salvagePct);
  const terrainMultiplier = getTerrainDepreciationMultiplier(terrain);
  const depUsagePerKm = (depreciableBase * usageShare) / lifeKm;
  const depUsageCostInr = isExcluded("depreciation_usage") ? 0 : depUsagePerKm * distance_km * terrainMultiplier;

  // ── Annual-km fixed costs (Unnati method) ───────────────────────────────────
  // A trip is treated as "seeking a return load" (and therefore includes the
  // return-load wait time in the utilization estimate) whenever the trip isn't
  // one-way and the configured empty-return fraction isn't a guaranteed 100%
  // empty. This mirrors the trip_type/empty_return_pct semantics already used
  // for the empty-return line below.
  const emptyReturnPctResolved = overrides?.empty_return_pct ?? profile.empty_return_pct;
  const hasReturnLoad = trip_type !== "one-way" && emptyReturnPctResolved < 1;
  const annualKm = estimateAnnualKm(distance_km, avg_speed_kmh, hasReturnLoad, guidelines);

  const depAgingAnnual = (depreciableBase * agingShare) / lifeYears;
  const depAgingPerKm = annualKm > 0 ? depAgingAnnual / annualKm : 0;
  const depAgingCostInr = isExcluded("depreciation_aging") ? 0 : depAgingPerKm * distance_km;

  const insurancePerYear = resolve(profile, overrides, "insurance_per_year");
  const insurancePerKm = annualKm > 0 ? insurancePerYear / annualKm : 0;
  const insuranceCostInr = isExcluded("insurance") ? 0 : insurancePerKm * distance_km;

  const roadTaxPerYear = resolve(profile, overrides, "road_tax_per_year");
  const roadTaxPerKm = annualKm > 0 ? roadTaxPerYear / annualKm : 0;
  const roadTaxCostInr = isExcluded("road_tax") ? 0 : roadTaxPerKm * distance_km;

  const fitnessPerYear = resolve(profile, overrides, "fitness_per_year");
  const fitnessPerKm = annualKm > 0 ? fitnessPerYear / annualKm : 0;
  const fitnessCostInr = isExcluded("fitness") ? 0 : fitnessPerKm * distance_km;

  const interestPerYear = resolve(profile, overrides, "interest_per_year");
  const interestPerKm = annualKm > 0 ? interestPerYear / annualKm : 0;
  const interestCostInr = isExcluded("interest") ? 0 : interestPerKm * distance_km;

  // ── Optional fixed add-ons (off by default; only costed when > 0) ─────────
  function optionalAnnualLine(annualAmount: number | undefined) {
    const amount = annualAmount ?? 0;
    const perKm = amount > 0 && annualKm > 0 ? amount / annualKm : 0;
    return { perKm, costInr: perKm * distance_km, annualAmount: amount };
  }
  const gps = isExcluded("gps") ? { perKm: 0, costInr: 0, annualAmount: 0 } : optionalAnnualLine(overrides?.gps_per_year ?? profile.gps_per_year);
  const fastag = isExcluded("fastag_fee") ? { perKm: 0, costInr: 0, annualAmount: 0 } : optionalAnnualLine(overrides?.fastag_fee_per_year ?? profile.fastag_fee_per_year);
  const rto = isExcluded("rto_misc") ? { perKm: 0, costInr: 0, annualAmount: 0 } : optionalAnnualLine(overrides?.rto_misc_per_year ?? profile.rto_misc_per_year);
  const tarpaulin = isExcluded("tarpaulin") ? { perKm: 0, costInr: 0, annualAmount: 0 } : optionalAnnualLine(overrides?.tarpaulin_per_year ?? profile.tarpaulin_per_year);
  const otherFixed = isExcluded("other_fixed") ? { perKm: 0, costInr: 0, annualAmount: 0 } : optionalAnnualLine(overrides?.other_fixed_per_year ?? profile.other_fixed_per_year);

  // ── Toll & permits ───────────────────────────────────────────────────────
  const tollAndPermitCostInr = toll.total_inr + (overrides?.state_permit ?? 0);

  // ── Loading ──────────────────────────────────────────────────────────────
  const loadingPerTon = resolve(profile, overrides, "loading_per_ton");
  const loadingCostInr = loadingPerTon * payloadTons;

  // ── Empty return / backhaul ─────────────────────────────────────────────
  const emptyReturnFraction = trip_type === "one-way" ? 0 : emptyReturnPctResolved;
  const emptyReturnDistanceKm = overrides?.empty_km ?? distance_km * emptyReturnFraction;
  // The empty leg still carries the truck's full per-km cost burden (fuel,
  // maintenance, tyres, both depreciation lines, and every annual-km fixed
  // cost) — the truck doesn't stop owing money just because it's unloaded.
  // Rebuild with exclusions: each component must be zeroed if its head is excluded.
  const backhaulVariablePerKm =
    fuelPerKm +
    (isExcluded("maintenance") ? 0 : maintenancePerKm) +
    (isExcluded("tyres") ? 0 : tyresPerKm) +
    (isExcluded("depreciation_usage") ? 0 : depUsagePerKm * terrainMultiplier) +
    (isExcluded("depreciation_aging") ? 0 : depAgingPerKm) +
    (isExcluded("insurance") ? 0 : insurancePerKm) +
    (isExcluded("road_tax") ? 0 : roadTaxPerKm) +
    (isExcluded("fitness") ? 0 : fitnessPerKm) +
    (isExcluded("interest") ? 0 : interestPerKm);
  const emptyReturnCostInr = emptyReturnDistanceKm * backhaulVariablePerKm;

  // ── Overhead & Profit (two markups on the cost base) ────────────────────
  // Base excludes toll, loading, and empty-return — matching the Unnati
  // Excel, which applies its 7%/10% markups only to the fixed+fuel+tyre+
  // maintenance(+depreciation here) base, not to pass-through/downstream
  // items like tolls or the backhaul mirror line.
  const overheadProfitBase =
    driverCostInr +
    helperCostInr +
    fuelCostInr +
    maintenanceCostInr +
    tyresCostInr +
    depUsageCostInr +
    depAgingCostInr +
    insuranceCostInr +
    roadTaxCostInr +
    fitnessCostInr +
    interestCostInr +
    gps.costInr +
    fastag.costInr +
    rto.costInr +
    tarpaulin.costInr +
    otherFixed.costInr;

  const overheadPct = overrides?.overhead_pct ?? guidelines.overhead_pct;
  const profitPct = overrides?.profit_pct ?? guidelines.profit_pct;
  const overheadCostInr = overheadProfitBase * overheadPct;
  const profitCostInr = overheadProfitBase * profitPct;

  // ── Assemble lines ───────────────────────────────────────────────────────
  const lines: CostLine[] = [];

  const push = (id: CostHeadId, name: string, formula: string, amount_inr: number, inputs: Record<string, string | number>) => {
    lines.push({ id, sno: 0, name, formula, amount_inr: round(amount_inr), inputs });
  };

  push("fuel", "Fuel Cost", "(Distance ÷ Mileage) × Diesel price", fuelCostInr, {
    distance_km,
    mileage_kmpl: mileage,
    diesel_inr: diesel_price_inr,
  });

  if (!isExcluded("driver")) {
    push(
      "driver",
      "Driver Salary",
      "(Per-day rate × trip days) + bata + night halts — days-based",
      driverCostInr,
      { days, driver_per_day: driverPerDay, bata_per_trip: bataPerTrip, night_halt_per_night: nightHaltPerNight }
    );
  }

  if (helperCostInr > 0) {
    push("helper", "Helper / Cleaner Salary", "Per-day rate × trip days — days-based", helperCostInr, {
      days,
      helper_per_day: helperPerDay,
    });
  }

  if (!isExcluded("maintenance")) {
    push("maintenance", "Maintenance", "₹/km × distance", maintenanceCostInr, {
      per_km: maintenancePerKm,
      distance_km,
    });
  }

  if (!isExcluded("tyres")) {
    push(
      "tyres",
      "Tyres",
      "(No. of tyres × cost per tyre ÷ tyre life km) × distance",
      tyresCostInr,
      { count: tyresCount, cost_per_tyre: tyresCostPerTyre, life_km: tyresLifeKm, distance_km }
    );
  }

  if (!isExcluded("depreciation_usage")) {
    push(
      "depreciation_usage",
      "Depreciation (Usage)",
      "(Depreciable base × usage share ÷ life km) × distance × terrain multiplier",
      depUsageCostInr,
      {
        depreciable_base_inr: round(depreciableBase),
        usage_share: usageShare,
        life_km: lifeKm,
        distance_km,
        terrain: terrain ?? "Plain",
        terrain_multiplier: terrainMultiplier,
      }
    );
  }

  if (!isExcluded("depreciation_aging")) {
    push(
      "depreciation_aging",
      "Depreciation (Aging)",
      "(Depreciable base × aging share ÷ life years) ÷ annual km × distance",
      depAgingCostInr,
      {
        depreciable_base_inr: round(depreciableBase),
        aging_share: agingShare,
        life_years: lifeYears,
        annual_km: Math.round(annualKm),
        distance_km,
      }
    );
  }

  if (!isExcluded("insurance")) {
    push("insurance", "Insurance", "Annual premium ÷ annual km × distance", insuranceCostInr, {
      insurance_per_year: insurancePerYear,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }

  if (!isExcluded("road_tax")) {
    push("road_tax", "Road Tax / Permit", "Annual road tax ÷ annual km × distance", roadTaxCostInr, {
      road_tax_per_year: roadTaxPerYear,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }

  if (!isExcluded("fitness")) {
    push("fitness", "Fitness Certificate", "Annual fitness cost ÷ annual km × distance", fitnessCostInr, {
      fitness_per_year: fitnessPerYear,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }

  if (!isExcluded("interest")) {
    push("interest", "Interest (Loan Carrying Cost)", "Annual loan interest ÷ annual km × distance", interestCostInr, {
      interest_per_year: interestPerYear,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }

  if (gps.costInr > 0) {
    push("gps", "GPS Charges", "Annual GPS cost ÷ annual km × distance", gps.costInr, {
      gps_per_year: gps.annualAmount,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }
  if (fastag.costInr > 0) {
    push("fastag_fee", "FASTag Service Fee", "Annual FASTag service fee ÷ annual km × distance", fastag.costInr, {
      fastag_fee_per_year: fastag.annualAmount,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }
  if (rto.costInr > 0) {
    push("rto_misc", "RTO / Miscellaneous", "Annual RTO/misc cost ÷ annual km × distance", rto.costInr, {
      rto_misc_per_year: rto.annualAmount,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }
  if (tarpaulin.costInr > 0) {
    push("tarpaulin", "Tarpaulin", "Annual tarpaulin cost ÷ annual km × distance", tarpaulin.costInr, {
      tarpaulin_per_year: tarpaulin.annualAmount,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }
  if (otherFixed.costInr > 0) {
    push("other_fixed", "Other Fixed Costs", "Annual other-fixed cost ÷ annual km × distance", otherFixed.costInr, {
      other_fixed_per_year: otherFixed.annualAmount,
      annual_km: Math.round(annualKm),
      distance_km,
    });
  }

  push("toll", "Toll & Permits", "Actual route toll + state permit", tollAndPermitCostInr, {
    toll_api: toll.total_inr,
    permit: overrides?.state_permit ?? 0,
    plazas: toll.plaza_count,
    distance_km,
  });

  push("loading", "Loading & Unloading", "₹/ton × payload", loadingCostInr, {
    payload_tons: payloadTons,
    per_ton: loadingPerTon,
  });

  push(
    "empty_return",
    "Empty Return (Backhaul)",
    "Empty-return km × blended variable ₹/km",
    emptyReturnCostInr,
    {
      empty_km: round(emptyReturnDistanceKm, 0),
      empty_pct: emptyReturnFraction,
      variable_per_km: round(backhaulVariablePerKm, 2),
    }
  );

  const subtotal = lines.reduce((s, l) => s + l.amount_inr, 0);

  push("overhead", "Overhead", `${(overheadPct * 100).toFixed(0)}% of cost base (excl. toll, loading, empty return)`, overheadCostInr, {
    base_inr: round(overheadProfitBase),
    overhead_pct: overheadPct,
  });
  push("profit", "Transporter Profit", `${(profitPct * 100).toFixed(0)}% of cost base (excl. toll, loading, empty return)`, profitCostInr, {
    base_inr: round(overheadProfitBase),
    profit_pct: profitPct,
  });

  // Sum the already-rounded overhead/profit line amounts (not the raw
  // overheadCostInr/profitCostInr floats) so total_inr always equals
  // subtotal_inr + overhead.amount_inr + profit.amount_inr exactly — avoids
  // an off-by-one from rounding the sum vs summing the rounded parts.
  const overheadLine = lines.find((l) => l.id === "overhead")!;
  const profitLine = lines.find((l) => l.id === "profit")!;
  const subtotalRounded = round(subtotal);
  const total = subtotalRounded + overheadLine.amount_inr + profitLine.amount_inr;

  const numbered = lines.map((l, i) => ({ ...l, sno: i + 1 }));

  return {
    lines: numbered,
    subtotal_inr: subtotalRounded,
    total_inr: total,
    trip_days: days,
  };
}

function round(n: number, decimals = 0): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
