# Phase P0 — ZBC Model Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ZBC calculator's cost model with the hybrid Fixed/Variable/Margin model decided in `docs/superpowers/specs/2026-07-02-zbc-refactor-prd.md` (§5) and reconciled against the Unnati Excel (`docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md`): driver/helper salary allocated by trip-days, all other fixed costs (depreciation-aging, insurance, road tax, fitness, interest) allocated by an annual-km utilization engine, depreciation split into aging (fixed) + usage (variable, terrain-scaled) lines, and overhead (7%) + profit (10%) as two separate markups replacing the old single `risk_pct`.

**Architecture:** All new logic lives in `lib/zbc/` (pure functions, no I/O). A new `lib/zbc/utilization.ts` module implements the trip-duration/uptime/annual-km engine. `lib/zbc/calculate.ts` is rewritten to consume it. `config/truck-rates.json` gets a new field set (via a one-off migration script) and a new `config/zbc-guidelines.json` holds the global utilization/overhead/profit constants. Every call site that referenced the four retired fields (`depreciation_per_km`, `vehicle_per_trip`, `overhead_per_trip`, `risk_pct`) is updated to compile and behave sensibly against the new field set — this includes both orchestration files, both single/batch API route Zod schemas, the CSV batch override columns, the advanced-override form, the breakdown detail panels, the route cost-sharing module, and the methodology export. UI redesign (checkboxes, "Add more components" panel, per-field source badges) is explicitly **out of scope** — that is Phase P2/P3 territory; this phase only needs the app to build, calculate correctly, and render usable (if not yet fully polished) output.

**Tech Stack:** TypeScript, Next.js 15 API routes, Zod, Vitest.

## Global Constraints

- Never commit without explicit user permission (CLAUDE.md).
- Match existing code style/patterns; don't refactor adjacent code beyond what this model change requires.
- `npx tsc --noEmit` and `npx vitest run` must both be clean at the end of every task that touches shared types.
- All monetary rounding uses whole rupees via the existing `round()` helper pattern (see `lib/zbc/calculate.ts`).
- Add explanatory comments above non-obvious formulas (CLAUDE.md).
- UI copy/layout changes are minimal — just enough to reference correct field names, not a redesign (deferred to P2/P3).

---

### Task 1: ZBC guidelines config + terrain multiplier + config getters

**Files:**
- Create: `config/zbc-guidelines.json`
- Modify: `config/fallback-rates.json`
- Modify: `lib/config.ts`
- Test: `lib/config.test.ts` (new file)

**Interfaces:**
- Produces: `getZbcGuidelines(): ZbcGuidelines` (from `lib/config.ts`), `getTerrainDepreciationMultiplier(terrain?: string): number` (from `lib/config.ts`). These are consumed by Task 3 (utilization) and Task 5 (calculate.ts).
- Depends on: `ZbcGuidelines` type, defined in Task 2. **Do this task's test-writing step after Task 2**, or stub the type inline — see Step 1.

- [ ] **Step 1: Create the guidelines config file**

Create `config/zbc-guidelines.json`:

```json
{
  "placement_hrs": 2,
  "plant_turnaround_hrs": 4,
  "client_turnaround_hrs": 4,
  "return_to_garage_hrs": 4,
  "rest_threshold_km": 150,
  "rest_hrs": 8,
  "return_load_wait_hrs": 12,
  "uptime_pct": 0.9,
  "overhead_pct": 0.07,
  "profit_pct": 0.10
}
```

These values are taken directly from the Unnati Excel `Guidelines` sheet (see
`docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md`), except `overhead_pct`/`profit_pct`
which match Unnati's `Guidelines!C27`/`C28`.

- [ ] **Step 2: Add the terrain multiplier to fallback-rates.json**

Read the current file first:

```bash
cat config/fallback-rates.json
```

Add a new top-level key `terrain_depreciation_multiplier` alongside the existing keys (`toll_per_km`,
`diesel_by_state`, etc.) — do not remove or reorder existing keys:

```json
"terrain_depreciation_multiplier": {
  "Plain": 1.0,
  "Hill": 1.4
}
```

- [ ] **Step 3: Write the failing test for the new config getters**

Create `lib/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getZbcGuidelines, getTerrainDepreciationMultiplier } from "@/lib/config";

describe("getZbcGuidelines", () => {
  it("returns the utilization + overhead/profit constants", () => {
    const g = getZbcGuidelines();
    expect(g.uptime_pct).toBe(0.9);
    expect(g.overhead_pct).toBe(0.07);
    expect(g.profit_pct).toBe(0.10);
    expect(g.rest_threshold_km).toBe(150);
  });
});

describe("getTerrainDepreciationMultiplier", () => {
  it("returns 1.0 for Plain", () => {
    expect(getTerrainDepreciationMultiplier("Plain")).toBe(1.0);
  });

  it("returns 1.4 for Hill", () => {
    expect(getTerrainDepreciationMultiplier("Hill")).toBe(1.4);
  });

  it("defaults to 1.0 for unknown/undefined terrain", () => {
    expect(getTerrainDepreciationMultiplier(undefined)).toBe(1.0);
    expect(getTerrainDepreciationMultiplier("Coastal")).toBe(1.0);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run lib/config.test.ts`
Expected: FAIL — `getZbcGuidelines is not a function` (doesn't exist yet).

- [ ] **Step 5: Implement the getters**

In `lib/config.ts`, add these imports at the top (alongside the existing ones):

```typescript
import zbcGuidelines from "@/config/zbc-guidelines.json";
```

Add this export at the end of the file:

```typescript
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
```

> **Note:** `ZbcGuidelines` is defined here in `lib/config.ts` rather than `lib/zbc/types.ts` to avoid
> a circular import risk (`lib/zbc/types.ts` has zero dependencies today — keep it that way). Task 2
> will import `ZbcGuidelines` as `import type { ZbcGuidelines } from "@/lib/config"`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add config/zbc-guidelines.json config/fallback-rates.json lib/config.ts lib/config.test.ts
git commit -m "feat(zbc): add utilization guidelines config and terrain multiplier lookup"
```

---

### Task 2: Rewrite lib/zbc/types.ts for the new cost model

**Files:**
- Modify: `lib/zbc/types.ts` (full rewrite of `TruckProfile`, `RateOverrides`, `CostHeadId`, `CalculateInput`)

**Interfaces:**
- Consumes: `ZbcGuidelines` from `lib/config.ts` (Task 1).
- Produces: `TruckProfile`, `RateOverrides`, `CostHeadId`, `CalculateInput`, `TyreProfile` — consumed by every subsequent task in this plan (utilization, calculate, validate, provenance, run-calculation, API schemas, UI components).

This task has no separate test file — it's a pure type change verified by `tsc --noEmit` at the end
of the plan (types have no runtime behavior to unit-test). Downstream tasks' tests exercise these
types indirectly.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `lib/zbc/types.ts` with:

```typescript
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
```

- [ ] **Step 2: Run the type checker to confirm the expected cascade of errors**

Run: `npx tsc --noEmit`
Expected: Many errors, in `lib/zbc/calculate.ts`, `lib/zbc/validate.ts`, `lib/zbc/cost-head-provenance.ts`,
`lib/zbc/route-adjustments.ts`, `lib/zbc/run-calculation.ts`, `lib/newzbc/run-calculation.ts`,
`app/api/calculate/route.ts`, `app/api/newcalculate/route.ts`, `app/api/calculate-batch/route.ts`,
`lib/csv/parse-batch.ts`, `lib/csv/template.ts`, `components/TripForm.tsx`,
`components/CostBreakdownTable.tsx`, `lib/export/methodology.ts` — all referencing the four retired
fields (`depreciation_per_km`, `vehicle_per_trip`, `overhead_per_trip`, `risk_pct`) or the old 9-line
`CostHeadId` union. This is expected — each subsequent task fixes one of these files. Do not attempt
to fix them all now; that's what the rest of this plan does.

- [ ] **Step 3: Commit**

```bash
git add lib/zbc/types.ts
git commit -m "feat(zbc): redefine TruckProfile/RateOverrides/CostHeadId for fixed+variable+margin model"
```

---

### Task 3: Trip-duration / uptime / annual-km utilization engine

**Files:**
- Create: `lib/zbc/utilization.ts`
- Test: `lib/zbc/utilization.test.ts`

**Interfaces:**
- Consumes: `ZbcGuidelines` type (`lib/config.ts`, Task 1).
- Produces: `tripDurationHours(distance_km, avg_speed_kmh, hasReturnLoad, guidelines): number`,
  `tripsPerMonth(trip_duration_hrs, uptime_pct): number`,
  `estimateAnnualKm(distance_km, avg_speed_kmh, hasReturnLoad, guidelines): number` — all consumed
  by Task 5 (`lib/zbc/calculate.ts`).

- [ ] **Step 1: Write the failing tests (golden values from the Unnati worked example)**

Create `lib/zbc/utilization.test.ts`. These test values are traced directly from
`docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md`'s Canter 6.5T / 500 km / 50 km/h /
80% return worked example (trip duration 44 hrs → 14 trips/month → 168,000 annual km):

```typescript
import { describe, expect, it } from "vitest";
import {
  tripDurationHours,
  tripsPerMonth,
  estimateAnnualKm,
} from "@/lib/zbc/utilization";
import { getZbcGuidelines } from "@/lib/config";

const g = getZbcGuidelines();

describe("tripDurationHours", () => {
  it("matches the Unnati worked example: 500km @ 50km/h with return load = 44 hrs", () => {
    // placement(2) + plant_turnaround(4) + travel(10) + client_turnaround(4)
    // + return_to_garage(4) + rest(8, since 500km > 150km threshold) + wait(12, has return load)
    expect(tripDurationHours(500, 50, true, g)).toBe(44);
  });

  it("omits the return-load wait when there is no return load", () => {
    expect(tripDurationHours(500, 50, false, g)).toBe(32); // 44 - 12
  });

  it("omits rest hours when distance is at or below the threshold", () => {
    // 100km @ 50km/h: travel=2hrs, no rest since 100 <= 150
    // 2 + 4 + 2 + 4 + 4 + 0 + 12 = 28
    expect(tripDurationHours(100, 50, true, g)).toBe(28);
  });

  it("rounds travel time up to the next whole hour", () => {
    // 501km @ 50km/h = 10.02 -> ceil to 11 hrs travel
    // 2 + 4 + 11 + 4 + 4 + 8 + 12 = 45
    expect(tripDurationHours(501, 50, true, g)).toBe(45);
  });
});

describe("tripsPerMonth", () => {
  it("matches the Unnati worked example: 44hr trips at 90% uptime = 14 trips/month", () => {
    expect(tripsPerMonth(44, 0.9)).toBe(14);
  });

  it("rounds down (never overcommits a partial trip)", () => {
    // 30*24/40*0.9 = 16.2 -> floor to 16
    expect(tripsPerMonth(40, 0.9)).toBe(16);
  });
});

describe("estimateAnnualKm", () => {
  it("matches the Unnati worked example: 500km trip -> 168,000 annual km", () => {
    expect(estimateAnnualKm(500, 50, true, g)).toBe(168000);
  });

  it("returns 0 for a degenerate zero-distance trip without throwing", () => {
    expect(() => estimateAnnualKm(0, 50, true, g)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/zbc/utilization.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/zbc/utilization"` (module doesn't exist yet).

- [ ] **Step 3: Implement the utilization engine**

Create `lib/zbc/utilization.ts`:

```typescript
import type { ZbcGuidelines } from "@/lib/config";

// Estimates how long one round-trip cycle takes, in hours. This mirrors the
// Unnati Excel "Master Sheet" utilization engine (rows 186-202): fixed
// handling times at each stage, plus travel time, plus rest breaks required
// by hours-of-service rules, plus (if applicable) time spent waiting to be
// loaded with a return cargo before heading back.
//
// distance_km is treated as one-way distance, matching Unnati's convention.
export function tripDurationHours(
  distance_km: number,
  avg_speed_kmh: number,
  hasReturnLoad: boolean,
  guidelines: ZbcGuidelines
): number {
  const travel_hrs = Math.ceil(distance_km / avg_speed_kmh);
  const rest_hrs = distance_km > guidelines.rest_threshold_km ? guidelines.rest_hrs : 0;
  const wait_hrs = hasReturnLoad ? guidelines.return_load_wait_hrs : 0;

  return (
    guidelines.placement_hrs +
    guidelines.plant_turnaround_hrs +
    travel_hrs +
    guidelines.client_turnaround_hrs +
    guidelines.return_to_garage_hrs +
    rest_hrs +
    wait_hrs
  );
}

// How many complete trip cycles fit into a 30-day month, discounted by the
// fleet's expected uptime (time lost to scheduled maintenance, driver rest
// days, breakdowns, etc. not already captured in trip_duration_hrs).
export function tripsPerMonth(trip_duration_hrs: number, uptime_pct: number): number {
  if (trip_duration_hrs <= 0) return 0;
  return Math.floor(((30 * 24) / trip_duration_hrs) * uptime_pct);
}

// Estimated annual km a truck covers running this kind of trip repeatedly.
// This is the denominator for every annual-km-allocated fixed cost line in
// lib/zbc/calculate.ts (depreciation-aging, insurance, road tax, fitness,
// interest, and the optional add-on fixed costs).
//
// ×2 accounts for the round trip (out + back); ×12 annualizes the monthly
// trip count.
export function estimateAnnualKm(
  distance_km: number,
  avg_speed_kmh: number,
  hasReturnLoad: boolean,
  guidelines: ZbcGuidelines
): number {
  const duration = tripDurationHours(distance_km, avg_speed_kmh, hasReturnLoad, guidelines);
  const trips = tripsPerMonth(duration, guidelines.uptime_pct);
  return trips * distance_km * 2 * 12;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/zbc/utilization.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/zbc/utilization.ts lib/zbc/utilization.test.ts
git commit -m "feat(zbc): add trip-duration/uptime/annual-km utilization engine (Unnati method)"
```

---

### Task 4: Migrate config/truck-rates.json to the new schema

**Files:**
- Create: `scripts/migrate-truck-rates.mjs`
- Modify: `config/truck-rates.json` (regenerated by running the script)

**Interfaces:**
- Produces: every truck profile in `config/truck-rates.json` conforming to the new `TruckProfile`
  shape from Task 2, plus a new `contribution_ranges` key set matching the new `CostHeadId` union.
  Consumed by every downstream task.

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-truck-rates.mjs`. This is a one-off Node script (run once, then the output
is committed as normal JSON — it is not part of the runtime app). It reads the current
`config/truck-rates.json`, keeps every field that's unaffected by the refactor, derives the new
fields with clearly-reasoned estimates (documented inline), computes `interest_per_year` using the
**exact same loan-amortization math as the Unnati Excel** (so P0's exit-criteria delta comparison in
Task 15 is apples-to-apples), and writes the new file.

```javascript
import { readFileSync, writeFileSync } from "fs";

const SRC = new URL("../config/truck-rates.json", import.meta.url);
const raw = JSON.parse(readFileSync(SRC, "utf8"));

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
```

> **Note on placeholder data:** `estimateExShowroom` and the flat insurance/road-tax/fitness
> defaults are explicitly documented P0 placeholders. Real per-model prices are Phase P1's job
> (`config/truck-models.json` enrichment per the PRD §6). The `contribution_ranges` values above are
> rough starting bands to keep `validateContributions()` functional — Phase P6 tunes them against
> real freight data (`data/fist200b4prob.xlsx`).

- [ ] **Step 2: Run the migration script**

```bash
node scripts/migrate-truck-rates.mjs
```

Expected output: `Migrated 46 trucks in config/truck-rates.json`

- [ ] **Step 3: Spot-check the output**

```bash
node -e "
const d = require('./config/truck-rates.json');
console.log(JSON.stringify(d.trucks['16T_6W'], null, 2));
console.log('truck count:', Object.keys(d.trucks).length);
"
```

Expected: a truck profile with all the new fields (`ex_showroom_inr`, `salvage_pct`, `life_years`,
`life_km`, `depreciation_aging_share`, `depreciation_usage_share`, `insurance_per_year`,
`road_tax_per_year`, `fitness_per_year`, `interest_per_year`, `tyres: {count, cost_per_tyre,
life_km}`), 46 trucks total, and none of the four retired fields
(`depreciation_per_km`/`vehicle_per_trip`/`overhead_per_trip`/`risk_pct`).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-truck-rates.mjs config/truck-rates.json
git commit -m "feat(zbc): migrate truck-rates.json to fixed+variable+margin schema"
```

---

### Task 5: Rewrite lib/zbc/calculate.ts (the core engine)

**Files:**
- Modify: `lib/zbc/calculate.ts` (full rewrite)
- Modify: `lib/zbc/calculate.test.ts` (migrate existing tests + add new ones)

**Interfaces:**
- Consumes: `TruckProfile`, `RateOverrides`, `CalculateInput`, `CostLine`, `CostHeadId`,
  `CalculateResult` (Task 2); `estimateAnnualKm` (Task 3); `getTerrainDepreciationMultiplier`
  (Task 1).
- Produces: `calculateZBC(input: CalculateInput): CalculateResult`, `tripDays(distance_km,
  avg_speed_kmh): number` (unchanged signature) — consumed by Task 9 and Task 10
  (`run-calculation.ts` files) and by Task 8 (`route-adjustments.ts`, which reads line `id`s).

- [ ] **Step 1: Update the existing test file's fixtures first (still failing — this is expected)**

Replace the entire contents of `lib/zbc/calculate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { calculateZBC, tripDays } from "@/lib/zbc/calculate";
import { validateContributions } from "@/lib/zbc/validate";
import { getTruckProfile, getZbcGuidelines } from "@/lib/config";

const guidelines = getZbcGuidelines();

describe("tripDays", () => {
  it("returns at least 1 day", () => {
    expect(tripDays(100, 45)).toBe(1);
    expect(tripDays(2000, 45)).toBeGreaterThan(1);
  });
});

describe("calculateZBC Delhi-Mumbai 16T", () => {
  const profile = getTruckProfile("16T_6W")!;
  const D = 1400;
  const days = tripDays(D, 45);

  const result = calculateZBC({
    truckId: "16T_6W",
    profile,
    payloadTons: 16,
    distance_km: D,
    days,
    diesel_price_inr: 93,
    toll: {
      total_inr: 7200,
      plaza_count: 24,
      provenance: {
        kind: "config",
        label: "NH-48 corridor benchmark",
        detail: "config/fallback-rates.json",
      },
    },
    avg_speed_kmh: 45,
    trip_type: "one-way",
    guidelines,
    terrain: "Plain",
  });

  it("has 15 cost lines for a one-way trip with defaults (no helper/optional add-ons)", () => {
    // fuel, driver, maintenance, tyres, depreciation_usage, depreciation_aging,
    // insurance, road_tax, fitness, interest, toll, loading, empty_return,
    // overhead, profit = 15. Helper and optional add-ons are omitted (off by
    // default, no override/profile value supplied).
    expect(result.lines).toHaveLength(15);
  });

  it("does not include a helper line when helper_per_day is unset", () => {
    expect(result.lines.find((l) => l.id === "helper")).toBeUndefined();
  });

  it("total equals subtotal plus overhead plus profit", () => {
    const overhead = result.lines.find((l) => l.id === "overhead")!;
    const profit = result.lines.find((l) => l.id === "profit")!;
    expect(result.total_inr).toBe(
      result.subtotal_inr + overhead.amount_inr + profit.amount_inr
    );
  });

  it("fuel is a large contributor, larger than overhead alone", () => {
    const fuel = result.lines.find((l) => l.id === "fuel")!;
    const overhead = result.lines.find((l) => l.id === "overhead")!;
    expect(fuel.amount_inr).toBeGreaterThan(0);
    expect(fuel.amount_inr).toBeGreaterThan(overhead.amount_inr);
  });

  it("profit is 10% of the cost base and overhead is 7% of the same base", () => {
    const overhead = result.lines.find((l) => l.id === "overhead")!;
    const profit = result.lines.find((l) => l.id === "profit")!;
    expect(Number(overhead.inputs.overhead_pct)).toBeCloseTo(0.07);
    expect(Number(profit.inputs.profit_pct)).toBeCloseTo(0.10);
    expect(Number(overhead.inputs.base_inr)).toBe(Number(profit.inputs.base_inr));
  });

  it("validateContributions returns a status per head", () => {
    const checks = validateContributions(result);
    expect(checks).toHaveLength(15);
    checks.forEach((c) => {
      expect(["ok", "low", "high"]).toContain(c.status);
      expect(c.pct).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("calculateZBC depreciation split", () => {
  const profile = getTruckProfile("9T_4W")!;
  const base = {
    truckId: "9T_4W",
    profile,
    payloadTons: 9,
    distance_km: 500,
    days: 2,
    diesel_price_inr: 90,
    toll: {
      total_inr: 1000,
      plaza_count: 5,
      provenance: { kind: "estimate" as const, label: "₹/km × distance" },
    },
    avg_speed_kmh: 45,
    trip_type: "one-way",
    guidelines,
  };

  it("usage depreciation is higher on Hill terrain than Plain terrain", () => {
    const plain = calculateZBC({ ...base, terrain: "Plain" });
    const hill = calculateZBC({ ...base, terrain: "Hill" });
    const plainDep = plain.lines.find((l) => l.id === "depreciation_usage")!.amount_inr;
    const hillDep = hill.lines.find((l) => l.id === "depreciation_usage")!.amount_inr;
    expect(hillDep).toBeGreaterThan(plainDep);
  });

  it("aging depreciation is unaffected by terrain", () => {
    const plain = calculateZBC({ ...base, terrain: "Plain" });
    const hill = calculateZBC({ ...base, terrain: "Hill" });
    const plainAging = plain.lines.find((l) => l.id === "depreciation_aging")!.amount_inr;
    const hillAging = hill.lines.find((l) => l.id === "depreciation_aging")!.amount_inr;
    expect(plainAging).toBe(hillAging);
  });
});

describe("calculateZBC with overrides", () => {
  const profile = getTruckProfile("9T_4W")!;

  it("applies overhead_pct and profit_pct overrides", () => {
    const base = calculateZBC({
      truckId: "9T_4W",
      profile,
      payloadTons: 9,
      distance_km: 500,
      days: 2,
      diesel_price_inr: 90,
      toll: {
        total_inr: 1000,
        plaza_count: 5,
        provenance: { kind: "estimate", label: "₹/km × distance" },
      },
      avg_speed_kmh: 45,
      trip_type: "one-way",
      guidelines,
    });
    const higherMargin = calculateZBC({
      truckId: "9T_4W",
      profile,
      payloadTons: 9,
      distance_km: 500,
      days: 2,
      diesel_price_inr: 90,
      toll: {
        total_inr: 1000,
        plaza_count: 5,
        provenance: { kind: "estimate", label: "₹/km × distance" },
      },
      overrides: { overhead_pct: 0.15, profit_pct: 0.2 },
      avg_speed_kmh: 45,
      trip_type: "one-way",
      guidelines,
    });
    expect(higherMargin.total_inr).toBeGreaterThan(base.total_inr);
  });

  it("adds a helper line only when helper_per_day override is supplied", () => {
    const withHelper = calculateZBC({
      truckId: "9T_4W",
      profile,
      payloadTons: 9,
      distance_km: 500,
      days: 2,
      diesel_price_inr: 90,
      toll: {
        total_inr: 1000,
        plaza_count: 5,
        provenance: { kind: "estimate", label: "₹/km × distance" },
      },
      overrides: { helper_per_day: 400 },
      avg_speed_kmh: 45,
      trip_type: "one-way",
      guidelines,
    });
    const helper = withHelper.lines.find((l) => l.id === "helper");
    expect(helper).toBeDefined();
    expect(helper!.amount_inr).toBe(800); // 400/day * 2 days
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/zbc/calculate.test.ts`
Expected: FAIL (multiple assertion failures — `calculate.ts` still uses the old model).

- [ ] **Step 3: Rewrite lib/zbc/calculate.ts**

Replace the entire contents of `lib/zbc/calculate.ts`:

```typescript
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

  // ── Fuel (variable) ────────────────────────────────────────────────────────
  const mileage = overrides?.mileage_kmpl ?? profile.mileage_kmpl_considered;
  const fuelCostInr = distance_km > 0 ? (distance_km / mileage) * diesel_price_inr : 0;
  const fuelPerKm = distance_km > 0 ? fuelCostInr / distance_km : 0;

  // ── Driver & helper (days-based fixed allocation) ─────────────────────────
  const driverPerDay = resolve(profile, overrides, "driver_per_day");
  const bataPerTrip = resolve(profile, overrides, "bata_per_trip");
  const nightHaltPerNight = resolve(profile, overrides, "night_halt_per_night");
  const driverCostInr =
    driverPerDay * days + bataPerTrip + nightHaltPerNight * Math.max(0, days - 1);

  const helperPerDay = overrides?.helper_per_day ?? profile.helper_per_day ?? 0;
  const helperCostInr = helperPerDay * days;

  // ── Maintenance (variable) ─────────────────────────────────────────────────
  const maintenancePerKm = resolve(profile, overrides, "maintenance_per_km");
  const maintenanceCostInr = maintenancePerKm * distance_km;

  // ── Tyres (variable) ────────────────────────────────────────────────────────
  const tyresCount = overrides?.tyres_count ?? profile.tyres.count;
  const tyresCostPerTyre = overrides?.tyres_cost_per_tyre ?? profile.tyres.cost_per_tyre;
  const tyresLifeKm = overrides?.tyres_life_km ?? profile.tyres.life_km;
  const tyresPerKm = (tyresCount * tyresCostPerTyre) / tyresLifeKm;
  const tyresCostInr = tyresPerKm * distance_km;

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
  const depUsageCostInr = depUsagePerKm * distance_km * terrainMultiplier;

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
  const depAgingCostInr = depAgingPerKm * distance_km;

  const insurancePerYear = resolve(profile, overrides, "insurance_per_year");
  const insurancePerKm = annualKm > 0 ? insurancePerYear / annualKm : 0;
  const insuranceCostInr = insurancePerKm * distance_km;

  const roadTaxPerYear = resolve(profile, overrides, "road_tax_per_year");
  const roadTaxPerKm = annualKm > 0 ? roadTaxPerYear / annualKm : 0;
  const roadTaxCostInr = roadTaxPerKm * distance_km;

  const fitnessPerYear = resolve(profile, overrides, "fitness_per_year");
  const fitnessPerKm = annualKm > 0 ? fitnessPerYear / annualKm : 0;
  const fitnessCostInr = fitnessPerKm * distance_km;

  const interestPerYear = resolve(profile, overrides, "interest_per_year");
  const interestPerKm = annualKm > 0 ? interestPerYear / annualKm : 0;
  const interestCostInr = interestPerKm * distance_km;

  // ── Optional fixed add-ons (off by default; only costed when > 0) ─────────
  function optionalAnnualLine(annualAmount: number | undefined) {
    const amount = annualAmount ?? 0;
    const perKm = amount > 0 && annualKm > 0 ? amount / annualKm : 0;
    return { perKm, costInr: perKm * distance_km, annualAmount: amount };
  }
  const gps = optionalAnnualLine(overrides?.gps_per_year ?? profile.gps_per_year);
  const fastag = optionalAnnualLine(overrides?.fastag_fee_per_year ?? profile.fastag_fee_per_year);
  const rto = optionalAnnualLine(overrides?.rto_misc_per_year ?? profile.rto_misc_per_year);
  const tarpaulin = optionalAnnualLine(overrides?.tarpaulin_per_year ?? profile.tarpaulin_per_year);
  const otherFixed = optionalAnnualLine(overrides?.other_fixed_per_year ?? profile.other_fixed_per_year);

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
  const backhaulVariablePerKm =
    fuelPerKm +
    maintenancePerKm +
    tyresPerKm +
    depUsagePerKm * terrainMultiplier +
    depAgingPerKm +
    insurancePerKm +
    roadTaxPerKm +
    fitnessPerKm +
    interestPerKm;
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

  push(
    "driver",
    "Driver Salary",
    "(Per-day rate × trip days) + bata + night halts — days-based",
    driverCostInr,
    { days, driver_per_day: driverPerDay, bata_per_trip: bataPerTrip, night_halt_per_night: nightHaltPerNight }
  );

  if (helperCostInr > 0) {
    push("helper", "Helper / Cleaner Salary", "Per-day rate × trip days — days-based", helperCostInr, {
      days,
      helper_per_day: helperPerDay,
    });
  }

  push("maintenance", "Maintenance", "₹/km × distance", maintenanceCostInr, {
    per_km: maintenancePerKm,
    distance_km,
  });

  push(
    "tyres",
    "Tyres",
    "(No. of tyres × cost per tyre ÷ tyre life km) × distance",
    tyresCostInr,
    { count: tyresCount, cost_per_tyre: tyresCostPerTyre, life_km: tyresLifeKm, distance_km }
  );

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

  push("insurance", "Insurance", "Annual premium ÷ annual km × distance", insuranceCostInr, {
    insurance_per_year: insurancePerYear,
    annual_km: Math.round(annualKm),
    distance_km,
  });

  push("road_tax", "Road Tax / Permit", "Annual road tax ÷ annual km × distance", roadTaxCostInr, {
    road_tax_per_year: roadTaxPerYear,
    annual_km: Math.round(annualKm),
    distance_km,
  });

  push("fitness", "Fitness Certificate", "Annual fitness cost ÷ annual km × distance", fitnessCostInr, {
    fitness_per_year: fitnessPerYear,
    annual_km: Math.round(annualKm),
    distance_km,
  });

  push("interest", "Interest (Loan Carrying Cost)", "Annual loan interest ÷ annual km × distance", interestCostInr, {
    interest_per_year: interestPerYear,
    annual_km: Math.round(annualKm),
    distance_km,
  });

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

  const total = subtotal + overheadCostInr + profitCostInr;

  const numbered = lines.map((l, i) => ({ ...l, sno: i + 1 }));

  return {
    lines: numbered,
    subtotal_inr: round(subtotal),
    total_inr: round(total),
    trip_days: days,
  };
}

function round(n: number, decimals = 0): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/zbc/calculate.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/zbc/calculate.ts lib/zbc/calculate.test.ts
git commit -m "feat(zbc): rewrite calculator for fixed+variable+margin model with annual-km utilization"
```

---

### Task 6: Update lib/zbc/validate.ts head labels

**Files:**
- Modify: `lib/zbc/validate.ts`

**Interfaces:**
- Consumes: `CostHeadId` (Task 2).
- Produces: `validateContributions` unchanged signature — already exercised by Task 5's tests.

- [ ] **Step 1: Replace HEAD_LABELS**

In `lib/zbc/validate.ts`, replace the `HEAD_LABELS` constant:

```typescript
const HEAD_LABELS: Record<CostHeadId, string> = {
  fuel: "Fuel Cost",
  driver: "Driver Salary",
  helper: "Helper / Cleaner Salary",
  maintenance: "Maintenance",
  tyres: "Tyres",
  depreciation_usage: "Depreciation (Usage)",
  depreciation_aging: "Depreciation (Aging)",
  insurance: "Insurance",
  road_tax: "Road Tax / Permit",
  fitness: "Fitness Certificate",
  interest: "Interest (Loan Carrying Cost)",
  gps: "GPS Charges",
  fastag_fee: "FASTag Service Fee",
  rto_misc: "RTO / Miscellaneous",
  tarpaulin: "Tarpaulin",
  other_fixed: "Other Fixed Costs",
  toll: "Toll & Permits",
  loading: "Loading & Unloading",
  empty_return: "Empty Return (Backhaul)",
  overhead: "Overhead",
  profit: "Transporter Profit",
};
```

- [ ] **Step 2: Run the type checker for this file**

Run: `npx tsc --noEmit 2>&1 | grep "validate.ts"`
Expected: no output (no errors in this file).

- [ ] **Step 3: Run the full test suite to confirm validate.ts tests (exercised via calculate.test.ts) still pass**

Run: `npx vitest run lib/zbc/calculate.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/zbc/validate.ts
git commit -m "feat(zbc): update contribution head labels for new cost model"
```

---

### Task 7: Update lib/zbc/cost-head-provenance.ts

**Files:**
- Modify: `lib/zbc/cost-head-provenance.ts`
- Modify: `lib/zbc/cost-head-provenance.test.ts`

**Interfaces:**
- Consumes: `CostHeadId`, `RateOverrides` (Task 2).
- Produces: `buildCostHeadProvenance(input): Omit<Record<CostHeadId, Provenance>, "fuel">` — consumed
  by Task 9 and Task 10 (`run-calculation.ts` files, unchanged call sites).

- [ ] **Step 1: Update the test file first**

Replace the contents of `lib/zbc/cost-head-provenance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCostHeadProvenance } from "@/lib/zbc/cost-head-provenance";

describe("buildCostHeadProvenance", () => {
  const tollEstimateProvenance = {
    kind: "estimate" as const,
    label: "₹/km × distance",
  };
  const tollApiProvenance = {
    kind: "api" as const,
    label: "TollGuru",
  };

  it("does not include fuel in the cost-head map", () => {
    const heads = buildCostHeadProvenance({ toll: tollEstimateProvenance });
    expect("fuel" in heads).toBe(false);
  });

  it("toll head reflects the toll provenance kind (estimate)", () => {
    const heads = buildCostHeadProvenance({ toll: tollEstimateProvenance });
    expect(heads.toll.kind).toBe("estimate");
  });

  it("toll head reflects the toll provenance kind (api)", () => {
    const heads = buildCostHeadProvenance({ toll: tollApiProvenance });
    expect(heads.toll.kind).toBe("api");
  });

  it("user override on driver produces kind 'input'", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { driver_per_day: 1200 },
    });
    expect(heads.driver.kind).toBe("input");
  });

  it("user override on ex_showroom_inr produces kind 'input' for both depreciation heads", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { ex_showroom_inr: 500000 },
    });
    expect(heads.depreciation_aging.kind).toBe("input");
    expect(heads.depreciation_usage.kind).toBe("input");
  });

  it("user override on overhead_pct produces kind 'input' for overhead only", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { overhead_pct: 0.1 },
    });
    expect(heads.overhead.kind).toBe("input");
    expect(heads.profit.kind).toBe("config");
  });

  it("non-overridden heads retain config provenance", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { driver_per_day: 1200 },
    });
    expect(heads.depreciation_aging.kind).toBe("config");
    expect(heads.maintenance.kind).toBe("config");
    expect(heads.loading.kind).toBe("config");
  });

  it("returns all expected cost heads", () => {
    const heads = buildCostHeadProvenance({ toll: tollEstimateProvenance });
    const keys = Object.keys(heads);
    [
      "driver", "helper", "maintenance", "tyres", "depreciation_usage",
      "depreciation_aging", "insurance", "road_tax", "fitness", "interest",
      "gps", "fastag_fee", "rto_misc", "tarpaulin", "other_fixed", "toll",
      "loading", "empty_return", "overhead", "profit",
    ].forEach((k) => expect(keys).toContain(k));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/zbc/cost-head-provenance.test.ts`
Expected: FAIL (`buildCostHeadProvenance` still returns the old 8-head shape).

- [ ] **Step 3: Rewrite lib/zbc/cost-head-provenance.ts**

Replace the entire contents:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/zbc/cost-head-provenance.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/zbc/cost-head-provenance.ts lib/zbc/cost-head-provenance.test.ts
git commit -m "feat(zbc): update cost-head provenance map for new cost heads"
```

---

### Task 8: Update lib/zbc/route-adjustments.ts (Theobroma cost-sharing)

**Files:**
- Modify: `lib/zbc/route-adjustments.ts`

**Interfaces:**
- Consumes: `CostHeadId` values as strings (this file intentionally has no import coupling to
  `lib/zbc/types.ts` — see file header comment).
- Produces: `applyRouteAdjustments<T extends AdjustableRow>(results: T[]): T[]` — unchanged
  signature, consumed by `app/api/calculate-batch/route.ts` (not modified in this plan; call site
  is untouched).

There is no dedicated test file for this module today; verification is via the existing
`app/api/calculate-batch/route.ts` integration (out of this plan's automated-test scope) plus the
manual verification in Task 15. This task edits code only.

- [ ] **Step 1: Update SPLIT_HEAD_IDS and the recompute logic**

In `lib/zbc/route-adjustments.ts`, replace the `SPLIT_HEAD_IDS` constant and the header comment
above it:

```typescript
// Cost heads that represent one trip's shared fixed cost and are therefore split
// equally across the route's stops. Fuel, Toll, and Depreciation (Usage) are
// intentionally excluded — they scale with each segment's actual km driven, so
// they stay per-segment. Overhead and Profit are excluded here because they are
// recomputed from the post-split cost base afterwards (dividing them directly
// would double-count the effect of the split).
const SPLIT_HEAD_IDS = new Set([
  "driver",
  "helper",
  "maintenance",
  "tyres",
  "depreciation_aging",
  "insurance",
  "road_tax",
  "fitness",
  "interest",
  "gps",
  "fastag_fee",
  "rto_misc",
  "tarpaulin",
  "other_fixed",
  "loading",
  "empty_return",
]);

// Cost heads excluded from the overhead/profit base recomputation below —
// mirrors the exclusion list in lib/zbc/calculate.ts's overheadProfitBase.
const MARKUP_EXCLUDED_IDS = new Set(["toll", "loading", "empty_return", "overhead", "profit"]);
```

- [ ] **Step 2: Replace the `adjustRow` function**

Replace the entire `adjustRow` function (everything from `function adjustRow` to its closing
brace):

```typescript
// Adjusts a single row: splits shared heads by the route size `n`, then
// recomputes overhead, profit, subtotal, total and per-line %.
function adjustRow(row: AdjustableRow, n: number): void {
  const lines = row.breakdown;

  // ── Split shared per-trip / per-day heads across the route's stops ──────────
  if (n > 1) {
    for (const line of lines) {
      if (SPLIT_HEAD_IDS.has(line.id)) {
        line.amount_inr = round(line.amount_inr / n);
      }
    }
  }

  // ── Recompute overhead & profit from the adjusted cost base ────────────────
  // The cost base is every line except toll, loading, empty_return, overhead,
  // and profit itself — same exclusion set lib/zbc/calculate.ts uses.
  const base = lines
    .filter((l) => !MARKUP_EXCLUDED_IDS.has(l.id))
    .reduce((s, l) => s + l.amount_inr, 0);

  const overheadLine = lines.find((l) => l.id === "overhead");
  const profitLine = lines.find((l) => l.id === "profit");

  const overheadPct =
    typeof overheadLine?.inputs?.overhead_pct === "number"
      ? (overheadLine.inputs.overhead_pct as number)
      : 0.07;
  const profitPct =
    typeof profitLine?.inputs?.profit_pct === "number"
      ? (profitLine.inputs.profit_pct as number)
      : 0.1;

  if (overheadLine) {
    overheadLine.amount_inr = round(base * overheadPct);
    if (overheadLine.inputs) overheadLine.inputs.base_inr = round(base);
  }
  if (profitLine) {
    profitLine.amount_inr = round(base * profitPct);
    if (profitLine.inputs) profitLine.inputs.base_inr = round(base);
  }

  const subtotal = lines
    .filter((l) => l.id !== "overhead" && l.id !== "profit")
    .reduce((s, l) => s + l.amount_inr, 0);
  const overhead = overheadLine?.amount_inr ?? 0;
  const profit = profitLine?.amount_inr ?? 0;
  const total = subtotal + overhead + profit;

  // ── Write back totals and recompute each line's % of total ─────────────
  row.subtotal = round(subtotal);
  row.total = round(total);
  for (const line of lines) {
    line.pct = total > 0 ? round((line.amount_inr / total) * 1000) / 10 : 0;
  }
}
```

- [ ] **Step 3: Update the file header comment's summary of what it does**

Replace the "What it does" paragraph near the top of the file:

```typescript
// What it does:
//   Route cost-sharing — all rows that share the same `route_name` are treated
//   as one physical trip. The per-trip / per-day / annual-km fixed cost heads
//   (driver, helper, maintenance, tyres, depreciation-aging, insurance, road
//   tax, fitness, interest, optional add-ons, loading, empty return) are
//   counted ONCE for the whole route and split equally across N = the number
//   of rows that share that route_name. Fuel, Toll, and Depreciation (Usage)
//   stay per-segment (each hop burns its own diesel, crosses its own plazas,
//   and wears the truck by its own actual km). Overhead and Profit are two
//   percentage markups, so they are recomputed from the post-split cost base
//   automatically (no separate division — that would double-count).
```

- [ ] **Step 4: Run the type checker for this file**

Run: `npx tsc --noEmit 2>&1 | grep "route-adjustments.ts"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/zbc/route-adjustments.ts
git commit -m "feat(zbc): update Theobroma route cost-sharing for new cost heads and markup recompute"
```

---

### Task 9: Wire terrain + guidelines into lib/zbc/run-calculation.ts

**Files:**
- Modify: `lib/zbc/run-calculation.ts`

**Interfaces:**
- Consumes: `getZbcGuidelines` (Task 1), updated `calculateZBC` signature requiring `guidelines`
  and accepting `terrain` (Task 5).
- Produces: unchanged `runCalculation(req: CalculationRequest): Promise<CalculationResponse>`
  signature — consumed by `app/api/calculate/route.ts` (Task 11).

- [ ] **Step 1: Add the guidelines import**

In `lib/zbc/run-calculation.ts`, update the import from `@/lib/config`:

```typescript
import { getTruckModel, getTruckProfile, getTruckRatesConfig, getZbcGuidelines } from "@/lib/config";
```

- [ ] **Step 2: Pass guidelines and terrain into the calculateZBC call**

Find the `calculateZBC({...})` call inside `runCalculation`. It currently ends with:

```typescript
    avg_speed_kmh: config.avg_speed_kmh,
    trip_type: tripType ?? "one-way",
  });
```

Replace those lines with:

```typescript
    avg_speed_kmh: config.avg_speed_kmh,
    trip_type: tripType ?? "one-way",
    guidelines: getZbcGuidelines(),
    terrain: returnLoad?.terrain === "Hill" ? "Hill" : "Plain",
  });
```

> `returnLoad` is already computed a few lines below the `calculateZBC` call in the current file
> (`const returnLoad = lookupReturnLoad(d.name, d.state);`). Move that line to **before** the
> `calculateZBC({...})` call so `returnLoad` is available when building the call's arguments — the
> rest of the file (the `marketRateEstimate` calculation and the final `return_load: returnLoad`
> field) stays exactly as-is, just reading the already-computed variable.

- [ ] **Step 3: Run the type checker for this file**

Run: `npx tsc --noEmit 2>&1 | grep "lib/zbc/run-calculation.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/zbc/run-calculation.ts
git commit -m "feat(zbc): wire terrain and guidelines into single-trip calculation orchestration"
```

---

### Task 10: Wire terrain + guidelines into lib/newzbc/run-calculation.ts

**Files:**
- Modify: `lib/newzbc/run-calculation.ts`

**Interfaces:**
- Consumes: `getZbcGuidelines` (Task 1), `lookupReturnLoad` (existing, `lib/zbc/return-load-master.ts`),
  updated `calculateZBC` signature (Task 5).
- Produces: unchanged `runCalculation(req: MultiStopCalculationRequest): Promise<CalculationResponse>`
  signature — consumed by `app/api/newcalculate/route.ts` (Task 11).

- [ ] **Step 1: Add the imports**

In `lib/newzbc/run-calculation.ts`, update the `@/lib/config` import:

```typescript
import { getTruckModel, getTruckProfile, getTruckRatesConfig, getZbcGuidelines } from "@/lib/config";
```

Add a new import for the return-load lookup (this file doesn't call it today):

```typescript
import { lookupReturnLoad } from "@/lib/zbc/return-load-master";
```

- [ ] **Step 2: Look up terrain for the final destination and pass it into calculateZBC**

Find the `calculateZBC({...})` call. It currently ends with:

```typescript
    avg_speed_kmh: config.avg_speed_kmh,
    trip_type: tripType ?? "one-way",
  });
```

Immediately **before** the `const result = calculateZBC({` line, add:

```typescript
  const finalDestReturnLoad = lookupReturnLoad(finalDest.name, finalDest.state);
```

Then replace the call's closing lines:

```typescript
    avg_speed_kmh: config.avg_speed_kmh,
    trip_type: tripType ?? "one-way",
    guidelines: getZbcGuidelines(),
    terrain: finalDestReturnLoad?.terrain === "Hill" ? "Hill" : "Plain",
  });
```

- [ ] **Step 3: Run the type checker for this file**

Run: `npx tsc --noEmit 2>&1 | grep "lib/newzbc/run-calculation.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/newzbc/run-calculation.ts
git commit -m "feat(zbc): wire terrain and guidelines into multi-stop calculation orchestration"
```

---

### Task 11: Update the three API route Zod schemas

**Files:**
- Modify: `app/api/calculate/route.ts`
- Modify: `app/api/newcalculate/route.ts`
- Modify: `app/api/calculate-batch/route.ts`

**Interfaces:**
- Produces: request-body validation matching the new `RateOverrides` shape (Task 2). No other file
  depends on these — they're the outermost layer.

All three files have an identical `overridesSchema` block (confirmed by inspection). Apply the same
edit to each.

- [ ] **Step 1: Replace the overrides schema in app/api/calculate/route.ts**

Replace the `overridesSchema` definition:

```typescript
const overridesSchema = z
  .object({
    distance_km: z.number().positive().optional(),
    mileage_kmpl: z.number().positive().optional(),
    driver_per_day: z.number().nonnegative().optional(),
    bata_per_trip: z.number().nonnegative().optional(),
    night_halt_per_night: z.number().nonnegative().optional(),
    helper_per_day: z.number().nonnegative().optional(),
    maintenance_per_km: z.number().nonnegative().optional(),
    tyres_count: z.number().positive().optional(),
    tyres_cost_per_tyre: z.number().nonnegative().optional(),
    tyres_life_km: z.number().positive().optional(),
    ex_showroom_inr: z.number().positive().optional(),
    salvage_pct: z.number().min(0).max(1).optional(),
    life_years: z.number().positive().optional(),
    life_km: z.number().positive().optional(),
    depreciation_aging_share: z.number().min(0).max(1).optional(),
    depreciation_usage_share: z.number().min(0).max(1).optional(),
    insurance_per_year: z.number().nonnegative().optional(),
    road_tax_per_year: z.number().nonnegative().optional(),
    fitness_per_year: z.number().nonnegative().optional(),
    interest_per_year: z.number().nonnegative().optional(),
    gps_per_year: z.number().nonnegative().optional(),
    fastag_fee_per_year: z.number().nonnegative().optional(),
    rto_misc_per_year: z.number().nonnegative().optional(),
    tarpaulin_per_year: z.number().nonnegative().optional(),
    other_fixed_per_year: z.number().nonnegative().optional(),
    loading_per_ton: z.number().nonnegative().optional(),
    empty_return_pct: z.number().min(0).max(1).optional(),
    empty_km: z.number().nonnegative().optional(),
    state_permit: z.number().nonnegative().optional(),
    overhead_pct: z.number().min(0).max(1).optional(),
    profit_pct: z.number().min(0).max(1).optional(),
    terrain: z.enum(["Plain", "Hill"]).optional(),
  })
  .optional();
```

- [ ] **Step 2: Apply the identical replacement to app/api/newcalculate/route.ts**

Open `app/api/newcalculate/route.ts`, find its `overridesSchema` block (same field list, same
shape, possibly different indentation since it may be nested inside a larger schema — check before
editing), and replace it with the same field list from Step 1.

- [ ] **Step 3: Apply the identical replacement to app/api/calculate-batch/route.ts**

Open `app/api/calculate-batch/route.ts`, find its `overridesSchema` block, and replace it with the
same field list from Step 1.

- [ ] **Step 4: Run the type checker for all three files**

Run: `npx tsc --noEmit 2>&1 | grep "app/api"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/api/calculate/route.ts app/api/newcalculate/route.ts app/api/calculate-batch/route.ts
git commit -m "feat(zbc): update API request validation for new override field set"
```

---

### Task 12: Update CSV batch overrides (parse-batch.ts + template.ts)

**Files:**
- Modify: `lib/csv/parse-batch.ts`
- Modify: `lib/csv/template.ts`

**Interfaces:**
- Consumes: `RateOverrides` (Task 2).
- Produces: unchanged `parseBatchCsv`/`validateBatchRows`/`getBatchCsvTemplate` signatures.

**Scope decision:** The CSV batch override columns keep the same *count and purpose* as today — a
small set of power-user overrides for the values a spreadsheet user would plausibly want to tweak
per row (distance, mileage, driver pay, maintenance rate, loading rate, permit, empty-return %).
The richer annual-km fixed-cost fields (insurance, road tax, interest, depreciation shares, etc.)
are **not** added as CSV columns — per the PRD, that level of editing belongs in the Configuration
tab form (Phase P2), not a raw CSV column. This keeps the batch template usable rather than
30+ columns wide.

- [ ] **Step 1: Update OVERRIDE_COLUMNS and the per-field validation list in parse-batch.ts**

In `lib/csv/parse-batch.ts`, replace the `OVERRIDE_COLUMNS` constant:

```typescript
const OVERRIDE_COLUMNS = [
  "truck_model_id",
  "distance_km",
  "mileage_kmpl",
  "driver_per_day",
  "bata_per_trip",
  "night_halt_per_night",
  "maintenance_per_km",
  "state_permit",
  "loading_per_ton",
  "empty_return_pct",
] as const;
```

Replace the `numericOverrides` array (the block starting `const numericOverrides: Array<{`):

```typescript
    const numericOverrides: Array<{
      key: keyof RateOverrides;
      col: string;
      min?: number;
      max?: number;
      positive?: boolean;
    }> = [
      { key: "distance_km", col: "distance_km", positive: true },
      { key: "mileage_kmpl", col: "mileage_kmpl", positive: true },
      { key: "driver_per_day", col: "driver_per_day", min: 0 },
      { key: "bata_per_trip", col: "bata_per_trip", min: 0 },
      { key: "night_halt_per_night", col: "night_halt_per_night", min: 0 },
      { key: "maintenance_per_km", col: "maintenance_per_km", min: 0 },
      { key: "state_permit", col: "state_permit", min: 0 },
      { key: "loading_per_ton", col: "loading_per_ton", min: 0 },
      { key: "empty_return_pct", col: "empty_return_pct", min: 0, max: 1 },
    ];
```

- [ ] **Step 2: Update the CSV template**

In `lib/csv/template.ts`, replace the `headers` array's override-column tail (everything from
`"mileage_kmpl",` through the end of the array) and the corresponding `exampleRow` tail:

```typescript
export function getBatchCsvTemplate(): string {
  const headers = [
    "body_type",
    "capacity_tons",
    "length_ft",
    "axles",
    "origin",
    "origin_lat_lng",
    "origin_lat",
    "origin_lng",
    "destination",
    "destination_lat_lng",
    "destination_lat",
    "destination_lng",
    "route_name",
    "payload_tons",
    "distance_km",
    "truck_model_id",
    "mileage_kmpl",
    "driver_per_day",
    "bata_per_trip",
    "night_halt_per_night",
    "maintenance_per_km",
    "state_permit",
    "loading_per_ton",
    "empty_return_pct",
  ];

  const exampleRow = [
    "open",   // body_type
    "16",     // capacity_tons
    "20",     // length_ft
    "2",      // axles
    "Delhi",  // origin
    "",       // origin_lat_lng  (optional — e.g. 28.6139,77.2090)
    "",       // origin_lat      (optional — use instead of origin_lat_lng)
    "",       // origin_lng      (optional — use instead of origin_lat_lng)
    "Mumbai", // destination
    "",       // destination_lat_lng  (optional — e.g. 19.0760,72.8777)
    "",       // destination_lat      (optional — use instead of destination_lat_lng)
    "",       // destination_lng      (optional — use instead of destination_lat_lng)
    "",       // route_name           (optional — e.g. "Route 1" or "1"; rows sharing a value are connected on the map)
    "14",     // payload_tons
    "",       // distance_km (optional override — replaces geocoded/routed distance)
    "",       // truck_model_id (optional)
    "",       // mileage_kmpl (optional override)
    "",       // driver_per_day
    "",       // bata_per_trip
    "",       // night_halt_per_night
    "",       // maintenance_per_km
    "",       // state_permit
    "",       // loading_per_ton
    "",       // empty_return_pct (0-1)
  ];

  return [headers.join(","), exampleRow.join(",")].join("\r\n");
}
```

- [ ] **Step 3: Run the batch parsing tests**

Run: `npx vitest run lib/csv/`
Expected: PASS (check for any existing test file referencing the old columns — if
`lib/csv/parse-batch.test.ts` exists and asserts on the old `OVERRIDE_COLUMNS` list, update its
expectations to match the new list from Step 1 before running).

- [ ] **Step 4: Run the type checker for both files**

Run: `npx tsc --noEmit 2>&1 | grep "lib/csv"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/parse-batch.ts lib/csv/template.ts
git commit -m "feat(zbc): trim batch CSV override columns to the new field set"
```

---

### Task 13: Update TripForm.tsx, CostBreakdownTable.tsx, and DataSourcesPanel.tsx

**Files:**
- Modify: `components/TripForm.tsx`
- Modify: `components/CostBreakdownTable.tsx`
- Modify: `components/DataSourcesPanel.tsx`

**Interfaces:**
- Consumes: `RateOverrides`, `CostHeadId` (Task 2), `BreakdownRow` (unchanged shape in
  `CostBreakdownTable.tsx`).
- Produces: no new interfaces — this is leaf UI. Full redesign (checkboxes, "Add more components",
  per-field source badges) is Phase P2/P3; this task only makes the existing advanced-override form
  and detail panels compile and show correct data for the new model.

> **Note:** `components/DataSourcesPanel.tsx` is dead code — grep confirms it is not imported by
> any other file in the app (only referenced from generated `graphify-out/` analysis artifacts,
> which are not part of the build). Per CLAUDE.md, leave it in place rather than deleting it, but
> it still participates in `tsc --noEmit` (TypeScript checks every file regardless of whether it's
> imported), so its two hardcoded head-id lists must be updated to compile — see Step 3 below.

- [ ] **Step 1: Update the advanced override fields in TripForm.tsx**

In `components/TripForm.tsx`, replace the block from `<p className="text-xs text-slate-500 pt-1">Vehicle depreciation</p>` through the end of the overrides section (down to but not including the closing `</div>` before the submit button):

```tsx
          <p className="text-xs text-slate-500 pt-1">Driver & Crew</p>
          <OverrideField label="Driver ₹/day" defaultVal={profile.driver_per_day} fieldKey="driver_per_day" setOverride={setOverride} />
          <OverrideField label="Bata allowance ₹/trip" defaultVal={profile.bata_per_trip} fieldKey="bata_per_trip" setOverride={setOverride} />
          <OverrideField label="Night halt ₹/night" defaultVal={profile.night_halt_per_night} fieldKey="night_halt_per_night" setOverride={setOverride} />
          <OverrideField label="Helper ₹/day (off by default)" defaultVal={profile.helper_per_day} fieldKey="helper_per_day" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Depreciation (Vehicle)</p>
          <OverrideField label="Ex-showroom price (₹)" defaultVal={profile.ex_showroom_inr} fieldKey="ex_showroom_inr" setOverride={setOverride} />
          <OverrideField label="Salvage value (0–1)" defaultVal={profile.salvage_pct} fieldKey="salvage_pct" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Maintenance</p>
          <OverrideField label="Maintenance ₹/km" defaultVal={profile.maintenance_per_km} fieldKey="maintenance_per_km" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Loading & Unloading</p>
          <OverrideField label="Loading ₹/ton" defaultVal={profile.loading_per_ton} fieldKey="loading_per_ton" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Overhead & Profit</p>
          <OverrideField label="Overhead % (0–1)" defaultVal={0.07} fieldKey="overhead_pct" setOverride={setOverride} />
          <OverrideField label="Profit % (0–1)" defaultVal={0.10} fieldKey="profit_pct" setOverride={setOverride} />
          <OverrideField label="State permit ₹/trip" defaultVal={undefined} fieldKey="state_permit" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Empty Return</p>
          <OverrideField label="Empty return % (0–1)" defaultVal={profile.empty_return_pct} fieldKey="empty_return_pct" setOverride={setOverride} />
```

> This keeps the field list roughly the same shape/size as before (driver/depreciation/maintenance/
> loading/overhead/empty-return groupings), just aligned to the new field names, plus two new
> fields (helper, ex-showroom price) that map directly to what the old form exposed
> (depreciation ₹/km ↔ vehicle cost) but now via the new formula's inputs. The full "pre-filled
> editable form for every fixed component with a source badge" from the PRD's Configuration tab is
> explicitly Phase P2 — not built here.

- [ ] **Step 2: Update the DetailPanel branches in CostBreakdownTable.tsx**

In `components/CostBreakdownTable.tsx`, remove the entire `if (id === "vehicle") { ... }` block
(lines referencing `inputs.depreciation_per_km`, which no longer exists).

Replace the `if (id === "overhead") { ... }` block with:

```tsx
  if (id === "overhead" || id === "profit") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>
          {((Number(inputs[id === "overhead" ? "overhead_pct" : "profit_pct"])) * 100).toFixed(0)}%
          of {formatInr(Number(inputs.base_inr))} cost base = <strong>{formatInr(row.amount_inr)}</strong>
        </p>
        <p className="text-slate-400">
          {id === "overhead"
            ? "Business overhead (dispatch, admin, insurance administration)"
            : "Transporter margin"}
        </p>
      </div>
    );
  }
```

Remove the entire `if (id === "risk") { ... }` block (superseded by the combined `overhead`/`profit`
branch above — the old `risk` head id no longer exists).

- [ ] **Step 3: Update the hardcoded head-id lists in DataSourcesPanel.tsx**

This file is dead code (unreferenced by any other app file — confirmed by grep, only appears in
generated `graphify-out/` artifacts) but still participates in `tsc --noEmit`. In
`components/DataSourcesPanel.tsx`, replace the `headOrder` array:

```typescript
  const headOrder: CostHeadId[] = [
    "fuel",
    "driver",
    "helper",
    "maintenance",
    "tyres",
    "depreciation_usage",
    "depreciation_aging",
    "insurance",
    "road_tax",
    "fitness",
    "interest",
    "toll",
    "loading",
    "empty_return",
    "overhead",
    "profit",
  ];
```

Replace the `headLabels` record:

```typescript
  const headLabels: Record<CostHeadId, string> = {
    fuel: "Fuel",
    driver: "Driver salary",
    helper: "Helper / cleaner salary",
    maintenance: "Maintenance",
    tyres: "Tyres",
    depreciation_usage: "Depreciation (usage)",
    depreciation_aging: "Depreciation (aging)",
    insurance: "Insurance",
    road_tax: "Road tax / permit",
    fitness: "Fitness certificate",
    interest: "Interest",
    gps: "GPS charges",
    fastag_fee: "FASTag service fee",
    rto_misc: "RTO / miscellaneous",
    tarpaulin: "Tarpaulin",
    other_fixed: "Other fixed costs",
    toll: "Toll & permits",
    loading: "Loading",
    empty_return: "Empty return",
    overhead: "Overhead",
    profit: "Transporter profit",
  };
```

> `headLabels` must be a complete `Record<CostHeadId, string>` (all 21 keys) to satisfy the type,
> even though `headOrder` (used for render order) only lists the 16 always-present heads — the six
> optional heads (`helper`, `gps`, `fastag_fee`, `rto_misc`, `tarpaulin`, `other_fixed`) simply never
> appear in `headOrder` so they never render, matching this file's existing pattern of a static
> render-order list separate from the full label map.

- [ ] **Step 4: Run the type checker for all three files**

Run: `npx tsc --noEmit 2>&1 | grep -E "TripForm.tsx|CostBreakdownTable.tsx|DataSourcesPanel.tsx"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add components/TripForm.tsx components/CostBreakdownTable.tsx components/DataSourcesPanel.tsx
git commit -m "feat(zbc): update advanced-override form and breakdown detail panels for new cost heads"
```

---

### Task 14: Update lib/export/methodology.ts

**Files:**
- Modify: `lib/export/methodology.ts`

**Interfaces:**
- Consumes: `config/truck-rates.json` shape (Task 4), `config/zbc-guidelines.json` (Task 1).
- Produces: unchanged `generateMethodologyMd(): string` signature.

- [ ] **Step 1: Update the local TruckProfile type**

In `lib/export/methodology.ts`, replace the local `TruckProfile` type:

```typescript
type TruckProfile = {
  label: string;
  body_type: string;
  payload_tons: number;
  toll_class: string;
  mileage_kmpl: number;
  mileage_kmpl_considered: number;
  driver_per_day: number;
  bata_per_trip: number;
  night_halt_per_night: number;
  maintenance_per_km: number;
  ex_showroom_inr: number;
  salvage_pct: number;
  interest_per_year: number;
  loading_per_ton: number;
  empty_return_pct: number;
};
```

- [ ] **Step 2: Update buildTruckTable's columns**

Replace the `buildTruckTable` function:

```typescript
function buildTruckTable(trucks: Record<string, TruckProfile>): string {
  const rows = Object.entries(trucks).map(([, t]) => t);

  const header = [
    "| Vehicle",
    "Payload",
    "Body",
    "Toll Class",
    "Effective Mileage (km/L)",
    "Driver Cost (₹/day)",
    "Bata (₹/trip)",
    "Night Halt (₹/night)",
    "Ex-Showroom (₹)",
    "Maintenance (₹/km)",
    "Loading (₹/ton)",
    "Empty Return |",
  ].join(" | ");

  const separator = "| " + Array(12).fill("---").join(" | ") + " |";

  const dataRows = rows.map((t) =>
    [
      `| ${t.label}`,
      `${t.payload_tons}T`,
      t.body_type === "open" ? "Open" : "Closed",
      TOLL_CLASS_LABELS[t.toll_class] ?? t.toll_class,
      t.mileage_kmpl_considered.toFixed(2),
      inr(t.driver_per_day),
      inr(t.bata_per_trip),
      inr(t.night_halt_per_night),
      inr(t.ex_showroom_inr),
      `₹${t.maintenance_per_km.toFixed(1)}`,
      inr(t.loading_per_ton),
      `${pct(t.empty_return_pct)} |`,
    ].join(" | ")
  );

  return [header, separator, ...dataRows].join("\n");
}
```

- [ ] **Step 3: Update the Cost Heads section of the generated markdown**

In the template literal inside `generateMethodologyMd()`, replace the `## Cost Heads` section:

```typescript
## Cost Heads

All amounts are in **₹ (Indian Rupees)** and are for a **one-way laden trip** unless otherwise noted.

Costs fall into three groups: **Fixed** (allocated by trip-days for driver/helper, or by an
annual-km utilization estimate for everything else), **Variable** (scales with distance driven),
and two **Margin** markups (overhead + profit) applied to the cost base.

| # | Cost Head | Basis | Formula |
|---|-----------|-------|---------|
| 1 | **Fuel** | Variable | (Distance ÷ Effective Mileage) × Diesel price |
| 2 | **Driver Salary** | Fixed (days) | (Driver/day × Trip days) + Bata + (Night halt × (Days − 1)) |
| 3 | **Helper Salary** | Fixed (days), off by default | Helper/day × Trip days |
| 4 | **Maintenance** | Variable | Maintenance ₹/km × Distance |
| 5 | **Tyres** | Variable | (Tyre count × Cost per tyre ÷ Tyre life km) × Distance |
| 6 | **Depreciation (Usage)** | Variable, terrain-scaled | (Depreciable base × usage share ÷ life km) × Distance × Terrain multiplier |
| 7 | **Depreciation (Aging)** | Fixed (annual-km) | (Depreciable base × aging share ÷ life years) ÷ Annual km × Distance |
| 8 | **Insurance** | Fixed (annual-km) | Annual premium ÷ Annual km × Distance |
| 9 | **Road Tax / Permit** | Fixed (annual-km) | Annual road tax ÷ Annual km × Distance |
| 10 | **Fitness Certificate** | Fixed (annual-km) | Annual fitness cost ÷ Annual km × Distance |
| 11 | **Interest (Loan Carrying Cost)** | Fixed (annual-km) | Annual loan interest ÷ Annual km × Distance |
| 12 | **Toll & Permits** | Pass-through | Actual FASTag toll + State permit override |
| 13 | **Loading & Unloading** | Variable | ₹/ton × Payload (tons) |
| 14 | **Empty Return (Backhaul)** | Variable | Empty km × Blended variable ₹/km *(one-way trips = ₹0)* |
| 15 | **Overhead** | Margin | 7% × Cost base (excl. toll, loading, empty return) |
| 16 | **Transporter Profit** | Margin | 10% × Cost base (excl. toll, loading, empty return) |

**Subtotal** = sum of all lines above except Overhead and Profit
**Total** = Subtotal + Overhead + Profit

> **Trip days** = ⌈Distance ÷ (${truckRatesJson.avg_speed_kmh} km/h × 24 h)⌉, minimum 1.
>
> **Annual km** (utilization estimate) = Trips/month × Distance × 2 × 12, where trips/month is
> derived from a trip-duration model (loading, turnaround, travel, rest, return-load wait) at 90%
> fleet uptime. See `config/zbc-guidelines.json` for the underlying constants.
```

- [ ] **Step 4: Update the Cost-Sharing (Batch only) section**

Replace its bullet list:

```typescript
## Cost-Sharing (Batch only)

When multiple rows share the same **route name**, they are treated as segments of one physical trip.
The following cost heads are **divided equally by N** (number of rows on that route):

- Driver Salary, Helper Salary
- Maintenance, Tyres
- Depreciation (Aging)
- Insurance, Road Tax / Permit, Fitness Certificate, Interest
- Loading & Unloading
- Empty Return

**Fuel**, **Toll**, and **Depreciation (Usage)** are kept per-segment (each hop burns its own
diesel, crosses its own plazas, and wears the truck by its own actual km driven). **Overhead** and
**Profit** are recomputed from the reduced cost base.
```

- [ ] **Step 5: Update the Empty Return, Benchmark Ranges, and Override Columns sections**

Replace the `## Empty Return (Backhaul)` formula block:

```typescript
\`\`\`
Empty return cost = Empty km × (Fuel + Maintenance + Tyres + Depreciation (both lines)
                                 + Insurance + Road Tax + Fitness + Interest) ₹/km
\`\`\`
```

Replace the `## Benchmark Ranges` table body to iterate the config directly instead of hardcoding
head names (avoids drifting out of sync again):

```typescript
| Cost Head | Normal Min | Normal Max |
|-----------|-----------|-----------|
${Object.entries(truckRatesJson.contribution_ranges)
  .map(([id, r]) => `| ${id.replace(/_/g, " ")} | ${r.min}% | ${r.max}% |`)
  .join("\n")}
```

Replace the `## Override Columns (Batch CSV / Excel)` table to match Task 12's trimmed column list:

```typescript
| Column | Description |
|--------|-------------|
| \`distance_km\` | Override the geocoded/routed distance (km) |
| \`mileage_kmpl\` | Override effective mileage (km/L) |
| \`driver_per_day\` | Driver cost per day (₹) |
| \`bata_per_trip\` | Bata allowance per trip (₹) |
| \`night_halt_per_night\` | Night halt cost per night (₹) |
| \`maintenance_per_km\` | Maintenance per km (₹) |
| \`state_permit\` | State permit / green tax (₹) |
| \`loading_per_ton\` | Loading & unloading per ton (₹) |
| \`empty_return_pct\` | Empty return fraction of laden distance (0–1) |

> More fixed-cost fields (insurance, road tax, interest, depreciation, overhead/profit %, etc.) can
> be overridden through the single-trip form's "Show advanced rates" panel; they are not exposed as
> batch CSV columns to keep the template manageable.
```

- [ ] **Step 6: Run the type checker for this file**

Run: `npx tsc --noEmit 2>&1 | grep "lib/export/methodology.ts"`
Expected: no output.

- [ ] **Step 7: Manually sanity-check the generated markdown**

```bash
node -e "
require('ts-node/register');
" 2>/dev/null; node --input-type=module -e "
import { generateMethodologyMd } from './lib/export/methodology.ts';
console.log(generateMethodologyMd().slice(0, 2000));
" 2>&1 || echo "If this fails due to TS/ESM loader issues, verify via the browser instead in Task 15 (Download methodology button)."
```

If the Node one-liner doesn't run cleanly (likely, since this is a Next.js TS module), that's fine
— defer visual verification to Task 15's browser check.

- [ ] **Step 8: Commit**

```bash
git add lib/export/methodology.ts
git commit -m "feat(zbc): update methodology export for fixed+variable+margin model"
```

---

### Task 15: Full verification + Unnati delta documentation

**Files:**
- No new source files. Verification only, plus one documentation update.
- Modify: `docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md` (append a "P0 Validation"
  section)

- [ ] **Step 1: Run the full type check**

Run: `npx tsc --noEmit`
Expected: no errors. If any remain, they indicate a call site this plan missed — grep for the
specific broken field/property name in the error and fix it following the same pattern as the
task above that touched the most similar file.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS. Note the total test count for the commit message in Step 6.

- [ ] **Step 3: Start the dev server and manually verify the single-trip flow**

```bash
npm run dev
```

Open `http://localhost:3001` (or whatever port it reports). Perform a single-trip calculation
(e.g. Delhi → Mumbai, 16T 6W truck, 16 tons) and confirm:
- The result renders without console errors.
- The breakdown table shows the new line items (Driver Salary, Maintenance, Tyres, Depreciation
  (Usage), Depreciation (Aging), Insurance, Road Tax / Permit, Fitness Certificate, Interest, Toll
  & Permits, Loading & Unloading, Empty Return, Overhead, Transporter Profit).
- "Show advanced rates" opens and the new override fields (ex-showroom price, salvage %, helper
  ₹/day, overhead %, profit %) are present and usable.
- Total = subtotal + overhead + profit (visually cross-check against the total card).
- "Download methodology ↓" produces a markdown file that opens and reads correctly (matches Task
  14's new content).

Take a screenshot if useful, per CLAUDE.md's browser-verification instruction. If anything renders
incorrectly, stop and fix it — do not proceed to Step 4 until this passes.

- [ ] **Step 4: Manually verify a batch upload with route cost-sharing**

Using the existing `data/theobroma route data.csv` (or `data/zbc test data.csv`), upload a batch
with at least one `route_name` shared by 2+ rows. Confirm:
- The batch calculates without errors.
- Rows sharing a `route_name` show visibly smaller Driver Salary / Maintenance / Depreciation
  (Aging) amounts than an equivalent standalone row (evidence the split from Task 8 is applying).
- Overhead and Profit amounts are consistent with 7%/10% of each row's (reduced) cost base — spot
  check one row's numbers by hand.

- [ ] **Step 5: Compute and document the Unnati delta**

Using the Canter 6.5T / 500 km / 50 km/h / 80% return worked example from
`docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md`, run the equivalent calculation
through the new engine (via the single-trip form, using the migrated `16T_6W` or a comparable
profile — exact truck-class parity with Unnati's "Canter 6.5T" isn't required; the point is to sanity
check the *shape* of the output, not achieve bit-for-bit parity, since P0 uses estimated
`ex_showroom_inr` rather than the real Canter 6.5T price Unnati used).

Append a new section to the end of `docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md`:

```markdown
---

## P0 Validation (post-implementation)

**Date:** <fill in actual date>

Ran a comparable trip (16T 6W, ~500 km, one return-load-likely trip) through the new engine and
compared against the pre-refactor model and the Unnati worked example.

| Metric | Old model (risk_pct) | New model (overhead+profit) | Unnati (reference) |
|---|---|---|---|
| Total freight | <fill in> | <fill in> | ₹5,657 (different truck class — shape reference only) |
| Fixed cost per km | <fill in> | <fill in> | ₹2.62/km (Canter 6.5T @ 168,000 annual km) |
| Overhead+Profit % of base | ~2-3% (risk only) | ~17% (7%+10%) | 17% (7%+10%) |

**Observations:** <fill in — e.g. "New model's freight total is X% higher/lower than the old model,
driven mainly by the two-markup overhead+profit structure replacing the smaller risk_pct.">

**Outstanding for Phase P1/P6:** `ex_showroom_inr`, `insurance_per_year`, `road_tax_per_year`,
`fitness_per_year` are still P0 migration-script estimates (see `scripts/migrate-truck-rates.mjs`),
not real per-model data. `contribution_ranges` bands are placeholders. Both get refined once real
truck data (Phase P1) and real freight validation against `data/fist200b4prob.xlsx` (Phase P6) land.
```

Fill in the `<fill in>` placeholders with actual numbers read off the running app in Step 3/4.

- [ ] **Step 6: Commit the validation notes**

```bash
git add docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md
git commit -m "docs(zbc): record P0 validation numbers against Unnati reference"
```

- [ ] **Step 7: Final full-suite confirmation**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean. This is the P0 exit criterion from the PRD (§11): "New calc tested; deltas
vs. Unnati documented; 45 tests migrated & green" — note the test count will now be higher than 45
(new tests added in Tasks 3, 5, 7), which is expected and fine; "45 tests migrated & green" means
none of the *original* 45 assertions were silently dropped, not that the count stays exactly 45.

---

## Summary of what P0 does NOT include (explicitly deferred)

- Truck data enrichment to specific models with real prices/mileage (Phase P1).
- Per-field source badges (real/proxy/estimate) in the UI (Phase P1/P2).
- Tabbed UI layout, auto-minimize on Calculate, Configuration tab with checkboxes and "Add more
  components" (Phase P2).
- Cost Breakdown tab redesign with source-on-top display (Phase P3).
- Route Map tab / route optimization / TollGuru multi-route alternatives (Phase P4).
- Batch on-demand route alternatives (Phase P5).
- Return-load probability tuning against real freight data (Phase P6).
