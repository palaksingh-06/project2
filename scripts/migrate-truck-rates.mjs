import { readFileSync, writeFileSync } from "fs";

const SRC = new URL("../config/truck-rates.json", import.meta.url);
// .replace(/^﻿/, "") strips a leading UTF-8 BOM present in the source
// file (pre-existing, unrelated to this migration) so JSON.parse doesn't choke.
const raw = JSON.parse(readFileSync(SRC, "utf8").replace(/^﻿/, ""));

// ── Global assumptions (from Unnati Guidelines sheet; see
//    docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md) ──────────────
const SALVAGE_PCT = 0.35;
const LIFE_YEARS = 10;
const LIFE_KM = LIFE_YEARS * 40000; // assume 40,000 km/year average lifetime utilization
const AGING_SHARE = 0.6;
const USAGE_SHARE = 0.4;
const INSURANCE_RATE = 0.025; // simplified flat annual premium rate (Unnati models a declining
                               // 5-year IDV schedule; flat rate is a documented P0 simplification,
                               // refined with real quotes in Phase P1/P6)
const ROAD_TAX_PER_YEAR = 22000; // Unnati Input_Data default, flat across truck classes for P0
const FITNESS_PER_YEAR = 4800;
const LOAN_PCT = 0.8;
const INTEREST_RATE = 0.11;
const LOAN_TERM_MONTHS = 60;
const TYRE_COST_PER_TYRE = 22500;
const TYRE_LIFE_KM = 75000;

// Ex-showroom price estimate, scaled by payload capacity. This is a P0
// placeholder — Phase P1 replaces it with real per-model prices researched
// from `data/truck_images.jpg` and public sources.
function estimateExShowroom(payloadTons) {
  return Math.round((300000 + payloadTons * 140000) / 1000) * 1000;
}

// Replicates the Unnati Master Sheet interest calculation exactly (PMT +
// month-by-month declining-balance interest extraction, averaged over the
// loan term) so P0's Unnati-delta comparison is apples-to-apples.
function computeAnnualInterest(exShowroomInr) {
  const principal = exShowroomInr * LOAN_PCT;
  const r = INTEREST_RATE / 12;
  const n = LOAN_TERM_MONTHS;
  const emi = (principal * r) / (1 - Math.pow(1 + r, -n));

  let balance = principal;
  let totalInterest = 0;
  for (let month = 1; month <= n; month++) {
    const interest = balance * r;
    const principalPaid = emi - interest;
    totalInterest += interest;
    balance -= principalPaid;
  }
  return Math.round(totalInterest / (n / 12));
}

const newTrucks = {};
for (const [id, t] of Object.entries(raw.trucks)) {
  const exShowroomInr = estimateExShowroom(t.payload_tons);
  newTrucks[id] = {
    label: t.label,
    body_type: t.body_type,
    length_ft: t.length_ft,
    axles: t.axles,
    payload_tons: t.payload_tons,
    wheels: t.wheels,
    toll_class: t.toll_class,
    mileage_kmpl: t.mileage_kmpl,
    mileage_kmpl_considered: t.mileage_kmpl_considered,

    driver_per_day: t.driver_per_day,
    bata_per_trip: t.bata_per_trip,
    night_halt_per_night: t.night_halt_per_night,
    // helper_per_day intentionally omitted (undefined) — off by default per PRD D2/D13.

    maintenance_per_km: t.maintenance_per_km,
    tyres: {
      count: t.wheels, // proxy: one tyre per wheel position; refined per-model in Phase P1
      cost_per_tyre: TYRE_COST_PER_TYRE,
      life_km: TYRE_LIFE_KM,
    },

    ex_showroom_inr: exShowroomInr,
    salvage_pct: SALVAGE_PCT,
    life_years: LIFE_YEARS,
    life_km: LIFE_KM,
    depreciation_aging_share: AGING_SHARE,
    depreciation_usage_share: USAGE_SHARE,

    insurance_per_year: Math.round(exShowroomInr * INSURANCE_RATE),
    road_tax_per_year: ROAD_TAX_PER_YEAR,
    fitness_per_year: FITNESS_PER_YEAR,
    interest_per_year: computeAnnualInterest(exShowroomInr),

    loading_per_ton: t.loading_per_ton,
    empty_return_pct: t.empty_return_pct,
  };
}

const newContributionRanges = {
  fuel: { min: 28, max: 40 },
  driver: { min: 8, max: 14 },
  helper: { min: 0, max: 6 },
  maintenance: { min: 3, max: 7 },
  tyres: { min: 2, max: 5 },
  depreciation_usage: { min: 2, max: 5 },
  depreciation_aging: { min: 4, max: 9 },
  insurance: { min: 1, max: 4 },
  road_tax: { min: 0, max: 3 },
  fitness: { min: 0, max: 2 },
  interest: { min: 0, max: 4 },
  gps: { min: 0, max: 2 },
  fastag_fee: { min: 0, max: 1 },
  rto_misc: { min: 0, max: 2 },
  tarpaulin: { min: 0, max: 1 },
  other_fixed: { min: 0, max: 3 },
  toll: { min: 4, max: 12 },
  loading: { min: 2, max: 6 },
  overhead: { min: 4, max: 9 },
  profit: { min: 6, max: 13 },
  empty_return: { min: 3, max: 12 },
};

const output = {
  avg_speed_kmh: raw.avg_speed_kmh,
  contribution_ranges: newContributionRanges,
  trucks: newTrucks,
};

writeFileSync(SRC, JSON.stringify(output, null, 2) + "\n");
console.log(`Migrated ${Object.keys(newTrucks).length} trucks in config/truck-rates.json`);
