# Phase P2 — UI Tabs + Configuration Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left-aligned tab bar (`Configuration · Cost Breakdown · Route Map`) above the results column, auto-minimize the input form on Calculate, and build a Configuration tab that shows every fixed/variable cost input pre-filled with a source badge, lets the user include/exclude any fixed cost head and edit any rate with live recompute, and shows an expandable full truck-data reference table.

**Architecture:** A new `activeResultTab` state in `app/page.tsx` drives which of three panels renders in the right column; `Route Map` is a placeholder in this phase (Phase P4 fills it in). A new `components/ConfigurationTab.tsx` owns the editable-fields UI and holds its own local override/exclusion state, calling back into `page.tsx`'s existing `handleCalculate` (debounced) whenever a field changes — reusing the single-trip calculate path already built in Phases P0/P1, not a new one. The engine gains one new capability: `excluded_heads?: CostHeadId[]` on `CalculateInput`, so `calculate.ts` can zero out any cost line the user turns off and correctly exclude it from the overhead/profit base and subtotal.

**Tech Stack:** TypeScript, React (Next.js client components), existing Tailwind design language.

## Global Constraints

- Never commit without explicit user permission — pre-authorized for this entire subagent-driven execution on branch `p0-zbc-model-refactor` (per session-start authorization), so subagents should commit without asking, same as Phases P0/P1.
- `npx tsc --noEmit` and `npx vitest run` must both be clean at the end of every task that touches shared types.
- Match existing Tailwind classes/patterns (see `components/TripForm.tsx`, `components/CostBreakdownTable.tsx` for the established visual language) — do not introduce a new UI kit or CSS approach.
- **Documented deviation from the PRD text:** the PRD (`docs/superpowers/specs/2026-07-02-zbc-refactor-prd.md` §5.1/§7.2) describes an `operating_days_per_month` field as "the fixed-cost divisor." This describes a days-based allocation method for depreciation/insurance/etc. that predates the Unnati-reconciliation decision — Phase P0 (already implemented, reviewed, and merged onto this branch) correctly replaced that days-divisor approach with the annual-km utilization engine for every fixed head except driver/helper salary (which use trip-days directly, with no separate monthly-salary-÷-days step — `driver_per_day` in `config/truck-rates.json` is already a final daily figure). Introducing a live `operating_days_per_month` UI control would either (a) do nothing, since no formula reads it, or (b) require reintroducing the exact days-divisor mechanism P0 deliberately moved away from after reconciling the PRD against the real Unnati spreadsheet. This plan does NOT implement that field. If this turns out to be the wrong call, it's a one-task follow-up, not a blocker — flagged here for visibility rather than silently dropped.
- **Documented scope decision:** "return-load probability, editable" from PRD §7.2 is implemented as the Configuration tab exposing the already-existing `empty_return_pct` override (pre-filled from `lookupReturnLoad(destination)`'s computed value), not as new engine surface — this is the field that already drives the empty-return calculation, so no new plumbing is needed.

---

### Task 1: Engine — add `excluded_heads` support to the calculator

**Files:**
- Modify: `lib/zbc/types.ts` (add `excluded_heads?: CostHeadId[]` to `CalculateInput`)
- Modify: `lib/zbc/calculate.ts` (skip excluded heads' cost and exclude them from `overheadProfitBase`/subtotal)
- Test: `lib/zbc/calculate.test.ts`

**Interfaces:**
- Produces: `CalculateInput.excluded_heads?: CostHeadId[]`, consumed by `calculateZBC()`. A head ID present in this array means that cost line is fully zeroed (amount 0, omitted from the returned `lines` array entirely — not shown at all, not just displayed as ₹0) and excluded from every downstream sum (`overheadProfitBase`, `subtotal`, `total`, and the `backhaulVariablePerKm` blend for empty-return). Consumed by Task 2 (`ConfigurationTab.tsx`'s toggle state) and Task 5 (wiring into the calculate request).
- Only heads that are genuinely excludable make sense here: `driver`, `helper`, `maintenance`, `tyres`, `depreciation_usage`, `depreciation_aging`, `insurance`, `road_tax`, `fitness`, `interest`, `gps`, `fastag_fee`, `rto_misc`, `tarpaulin`, `other_fixed`. Excluding `fuel`, `toll`, `loading`, `empty_return`, `overhead`, or `profit` is not meaningful (they're either always-present pass-throughs or the markups themselves) — if the caller passes one of these in `excluded_heads`, it's simply ignored (no error), since silently ignoring an out-of-scope exclusion is safer than crashing the calculator over a UI-layer bug in a later task.

- [ ] **Step 1: Write the failing test**

Add to `lib/zbc/calculate.test.ts`:

```typescript
it("zeroes an excluded head and excludes it from the overhead/profit base", () => {
  const baseInput = /* reuse this file's existing minimal valid CalculateInput fixture */;

  const withoutExclusion = calculateZBC(baseInput);
  const withExclusion = calculateZBC({ ...baseInput, excluded_heads: ["tyres"] });

  const tyresLineWithout = withoutExclusion.lines.find((l) => l.id === "tyres");
  const tyresLineWith = withExclusion.lines.find((l) => l.id === "tyres");
  expect(tyresLineWithout).toBeDefined();
  expect(tyresLineWith).toBeUndefined();

  // Total must drop by at least the excluded tyres line's amount, since
  // removing it also shrinks the overhead/profit base it fed into.
  expect(withExclusion.total_inr).toBeLessThan(withoutExclusion.total_inr);

  // Excluding a head not in the excludable list must be a no-op, not a crash.
  const withIgnoredExclusion = calculateZBC({ ...baseInput, excluded_heads: ["overhead" as never] });
  expect(withIgnoredExclusion.total_inr).toBe(withoutExclusion.total_inr);
});
```

(Adapt `baseInput` to whatever fixture pattern this test file already uses for a minimal valid `CalculateInput` — this file already has working `calculateZBC()` calls to model it on.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/zbc/calculate.test.ts`
Expected: FAIL — `excluded_heads` isn't read anywhere yet, so both calls produce identical results and the tyres line is present in both.

- [ ] **Step 3: Add the type**

In `lib/zbc/types.ts`, find the `CalculateInput` interface and add:

```typescript
  /** Cost head IDs to fully omit from this calculation (Configuration tab toggles). */
  excluded_heads?: CostHeadId[];
```

- [ ] **Step 4: Implement exclusion in calculate.ts**

In `lib/zbc/calculate.ts`, right after destructuring `input` (after the existing `const { profile, payloadTons, ... } = input;` block), add:

```typescript
  const excluded = new Set(input.excluded_heads ?? []);
  const isExcluded = (id: CostHeadId) => excluded.has(id);
```

Then wrap each excludable head's cost variable so it's zero when excluded, right where it's first computed. The cleanest way given the file's existing structure: multiply each cost-in-rupees variable by `isExcluded(id) ? 0 : 1` at the point it's computed, so every downstream use (per-km rates used in the backhaul blend, `overheadProfitBase`, `subtotal`) automatically reflects the exclusion. Concretely:

```typescript
  const driverCostInr = isExcluded("driver") ? 0 :
    driverPerDay * days + bataPerTrip + nightHaltPerNight * Math.max(0, days - 1);

  const helperCostInr = isExcluded("helper") ? 0 : helperPerDay * days;

  const maintenanceCostInr = isExcluded("maintenance") ? 0 : maintenancePerKm * distance_km;

  const tyresCostInr = isExcluded("tyres") ? 0 : tyresPerKm * distance_km;
```

...and similarly for `depUsageCostInr`, `depAgingCostInr`, `insuranceCostInr`, `roadTaxCostInr`, `fitnessCostInr`, `interestCostInr` (wrap each existing `const xCostInr = ...` line with `isExcluded("x") ? 0 : ...`). For the five optional add-ons, change `optionalAnnualLine`'s call sites instead — e.g. `const gps = isExcluded("gps") ? { perKm: 0, costInr: 0, annualAmount: 0 } : optionalAnnualLine(...)`.

**Important:** the per-km rates used in `backhaulVariablePerKm` (e.g. `maintenancePerKm`, `tyresPerKm`, `depUsagePerKm`, `depAgingPerKm`, `insurancePerKm`, `roadTaxPerKm`, `fitnessPerKm`, `interestPerKm`) are separate variables from the `*CostInr` ones and are NOT touched by the above — they still hold their non-zero per-km values even when the head is excluded, which would incorrectly still charge that cost via the empty-return backhaul blend. Fix this by rebuilding `backhaulVariablePerKm` to zero out each excluded component's contribution:

```typescript
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
```

Finally, in the `push(...)` calls that build the `lines` array, wrap each excludable head's `push(...)` call in `if (!isExcluded("<id>")) { push(...); }` so the line is omitted entirely (not shown with a ₹0 amount) — for the five optional add-ons this composes naturally with their existing `if (x.costInr > 0)` guard (an excluded optional head now has `costInr === 0` from the change above, so the existing guard already hides it — no separate change needed there beyond the `optionalAnnualLine` call-site fix).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/zbc/calculate.test.ts`
Expected: PASS (including all pre-existing tests in this file — re-run the whole file, not just the new test, to confirm no regression).

- [ ] **Step 6: Run the full type check and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/zbc/types.ts lib/zbc/calculate.ts lib/zbc/calculate.test.ts
git commit -m "feat(zbc): support excluding individual fixed cost heads from a calculation"
```

---

### Task 2: `CostSourceBadge` — reusable real/proxy/estimate badge component

**Files:**
- Create: `components/CostSourceBadge.tsx`
- Test: `components/CostSourceBadge.test.tsx`

**Interfaces:**
- Produces: `<CostSourceBadge source="real" | "proxy" | "estimate" />` — a small colored pill, consumed by Task 3 (`ConfigurationTab.tsx`).
- This is deliberately a SEPARATE badge system from the existing `lib/zbc/provenance.ts` (`ProvenanceKind = "api"|"config"|"estimate"|"input"|"error"`, used elsewhere for cost-HEAD provenance in `ProvenanceDrawer`/`CostBreakdownTable`). That system answers "how was this cost line computed" (API call vs. static config vs. user input); this new one answers "how trustworthy is this specific truck-model data POINT" (a `SourcedValue`'s `source` field from Phase P1's schema: `mileage_kmpl`, `ex_showroom_inr`). Conflating the two would blur a distinction Phase P1 spent real research effort establishing — keep them separate.

- [ ] **Step 1: Write the failing test**

Create `components/CostSourceBadge.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostSourceBadge } from "@/components/CostSourceBadge";

describe("CostSourceBadge", () => {
  it("renders the real label with the real styling", () => {
    render(<CostSourceBadge source="real" />);
    expect(screen.getByText(/real/i)).toBeInTheDocument();
  });

  it("renders the proxy label", () => {
    render(<CostSourceBadge source="proxy" />);
    expect(screen.getByText(/proxy/i)).toBeInTheDocument();
  });

  it("renders the estimate label", () => {
    render(<CostSourceBadge source="estimate" />);
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });
});
```

Check this project's `package.json`/`vitest.config.ts` for whether `@testing-library/react` is already a dependency and whether a jsdom environment is configured for component tests — if not already set up, add `@testing-library/react` as a devDependency and confirm/add a `jsdom` (or `happy-dom`) test environment for `.test.tsx` files (check if other `.tsx` test files already exist in this repo as a pattern to follow; if this is the first one, configure the minimal jsdom environment override, e.g. via a `// @vitest-environment jsdom` comment at the top of this test file, which doesn't require changing the global vitest config).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/CostSourceBadge.test.tsx`
Expected: FAIL — module doesn't exist yet (and/or missing test-library dependency, in which case install it first, then re-run to get the "module not found" failure for the component itself).

- [ ] **Step 3: Implement the component**

Create `components/CostSourceBadge.tsx`:

```tsx
export type CostSource = "real" | "proxy" | "estimate";

const STYLES: Record<CostSource, string> = {
  real: "bg-emerald-100 text-emerald-800",
  proxy: "bg-amber-100 text-amber-800",
  estimate: "bg-slate-200 text-slate-700",
};

const LABELS: Record<CostSource, string> = {
  real: "Real",
  proxy: "Proxy",
  estimate: "Estimate",
};

export function CostSourceBadge({ source }: { source: CostSource }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STYLES[source]}`}
      title={
        source === "real"
          ? "Sourced from a real published spec/price"
          : source === "proxy"
            ? "Derived from a close sibling model's real figure"
            : "No model-specific figure found; category-level estimate"
      }
    >
      {LABELS[source]}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/CostSourceBadge.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/CostSourceBadge.tsx components/CostSourceBadge.test.tsx package.json package-lock.json
git commit -m "feat(zbc): add CostSourceBadge component for real/proxy/estimate labeling"
```

(Include `package.json`/lockfile only if Step 1 required adding `@testing-library/react`.)

---

### Task 3: `ConfigurationTab` component — pre-filled fields, toggles, add-more-components, truck-data table

**Files:**
- Create: `components/ConfigurationTab.tsx`
- Test: `components/ConfigurationTab.test.tsx`

**Interfaces:**
- Consumes: `CostSourceBadge` (Task 2), `TruckModel`/`SourcedValue` (Phase P1's `lib/config.ts`), `RateOverrides`/`CostHeadId` (`lib/zbc/types.ts`), `getTruckProfile`/`getTruckModel` (`lib/config.ts`).
- Produces: `<ConfigurationTab truckId={string} modelId={string | undefined} overrides={RateOverrides} excludedHeads={CostHeadId[]} onChange={(overrides: RateOverrides, excludedHeads: CostHeadId[]) => void} />` — consumed by Task 4 (`app/page.tsx`'s tab-bar wiring) and Task 5 (live recompute).

This component is the biggest single piece of new UI in this phase. Structure it as:

1. **On-by-default fields** (always visible, each row: label, editable number input pre-filled from `getTruckProfile(truckId)` or the selected model's override, a `CostSourceBadge`, and an exclude checkbox for the heads listed in Task 1): Driver salary (₹/day), Maintenance (₹/km), Tyres (count / cost per tyre / life km — no exclude checkbox on sub-fields, one checkbox for the whole "Tyres" head), Depreciation inputs (ex-showroom price, salvage %, life years, life km, aging/usage share — one "Depreciation" exclude checkbox governs BOTH `depreciation_usage` and `depreciation_aging` together, since they share the same underlying inputs), Insurance (₹/year), Road tax (₹/year), Fitness (₹/year), Interest (₹/year).
2. **"Add more components" section** (collapsed by default, `<details>`/toggle-button pattern matching `TripForm.tsx`'s existing "advanced rates" collapsible): Helper salary (₹/day), GPS (₹/year), FASTag fee (₹/year), RTO/misc (₹/year), Tarpaulin (₹/year), Other fixed (₹/year) — each with its own exclude checkbox (unchecked/excluded by default, since these are off-by-default per the PRD's component table) and, once a nonzero value is entered, automatically counted as "included."
3. **Return-load probability** field: a single number input for `empty_return_pct` (0-1), pre-filled from `lookupReturnLoad(destinationName, destinationState)`'s computed `empty_haul_pct` when a destination is known, else the truck profile's default — labelled "Return-load probability (0 = always gets a paid return load, 1 = always returns empty)."
4. **Expandable truck-data reference table**: a collapsed `<details>` showing every raw field on `getTruckProfile(truckId)` (label, value) in a two-column table — read-only, for reference, "like the Excel master tables" per the PRD. If a `modelId` is selected, also show that model's `mileage_kmpl`/`ex_showroom_inr` with their `CostSourceBadge`.

For source badges on fields 1-3: a field shows `CostSourceBadge` with the selected MODEL's `source` (if `modelId` is set and that field maps to `mileage_kmpl`/`ex_showroom_inr`); otherwise show no badge (category-level truck-rates.json defaults don't carry real/proxy/estimate labels — only Phase P1's per-model data does). Don't fabricate a badge for fields with no real source label.

- [ ] **Step 1: Write the failing test**

Create `components/ConfigurationTab.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigurationTab } from "@/components/ConfigurationTab";

describe("ConfigurationTab", () => {
  it("pre-fills the driver rate from the truck profile", () => {
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={() => {}}
      />
    );
    const driverInput = screen.getByLabelText(/driver salary/i) as HTMLInputElement;
    expect(Number(driverInput.value)).toBeGreaterThan(0);
  });

  it("calls onChange with an override when a field is edited", () => {
    const onChange = vi.fn();
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={onChange}
      />
    );
    const driverInput = screen.getByLabelText(/driver salary/i);
    fireEvent.change(driverInput, { target: { value: "999" } });
    expect(onChange).toHaveBeenCalled();
    const [overridesArg] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(overridesArg.driver_per_day).toBe(999);
  });

  it("calls onChange with the head added to excludedHeads when its checkbox is unchecked", () => {
    const onChange = vi.fn();
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={onChange}
      />
    );
    const tyresCheckbox = screen.getByLabelText(/include tyres/i) as HTMLInputElement;
    fireEvent.click(tyresCheckbox);
    const [, excludedArg] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(excludedArg).toContain("tyres");
  });

  it("hides off-by-default add-ons behind a collapsed section", () => {
    render(
      <ConfigurationTab
        truckId="16T_6W"
        modelId={undefined}
        overrides={{}}
        excludedHeads={[]}
        onChange={() => {}}
      />
    );
    expect(screen.queryByLabelText(/gps/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/add more components/i));
    expect(screen.getByLabelText(/gps/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/ConfigurationTab.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

Build `components/ConfigurationTab.tsx` per the structure described above. Use `getTruckProfile(truckId)` and (if `modelId`) `getTruckModel(modelId)` from `@/lib/config` to compute pre-filled values exactly the same way `lib/zbc/run-calculation.ts` does (mileage × 0.7 factor, `ex_showroom_inr` from the model when present else the profile default) — don't duplicate that logic differently; import and reuse the same resolution shape conceptually (read `lib/zbc/run-calculation.ts`'s model-resolution block from Phase P1 Task 3 as the reference for how a model's price should pre-fill `ex_showroom_inr`).

Each editable field, on change, computes the full next `overrides` object and next `excludedHeads` array and calls `onChange(nextOverrides, nextExcludedHeads)` — the component holds no calculation logic itself, it only assembles the override/exclusion state and hands it up.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/ConfigurationTab.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/ConfigurationTab.tsx components/ConfigurationTab.test.tsx
git commit -m "feat(zbc): add ConfigurationTab with pre-filled fields, source badges, and include/exclude toggles"
```

---

### Task 4: Tab bar + auto-minimize wiring in app/page.tsx

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `ConfigurationTab` (Task 3), existing `CostBreakdownTable`, existing `formMinimized`/`setFormMinimized` state, existing `handleCalculate`/`result` state.
- Produces: new `activeResultTab: "configuration" | "breakdown" | "route"` state — no other file depends on this state's name since it's local to `page.tsx`.

- [ ] **Step 1: Add tab state and auto-minimize**

In `app/page.tsx`, add a new state near the existing `formMinimized` declaration:

```typescript
  const [activeResultTab, setActiveResultTab] = useState<"configuration" | "breakdown" | "route">("breakdown");
```

Find the function that handles a successful single-trip calculation (the `handleCalculate` function or equivalent that sets `result` on success) and add `setFormMinimized(true);` right after a successful result is set — this makes minimize automatic instead of only manual. Leave the existing manual `◂ Minimize` / `▸ Show input form` toggle buttons working exactly as they are today (auto-minimize is additive, not a replacement for manual control).

- [ ] **Step 2: Add the tab bar above the results column**

In the "Right column: results" section, right after the "Single trip results" condition opens (before the "Provenance button" div), add a left-aligned tab bar:

```tsx
              <div className="flex gap-1 border-b border-slate-200" data-print="hide">
                {(["configuration", "breakdown", "route"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveResultTab(t)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                      activeResultTab === t
                        ? "border-b-2 border-brand-700 text-brand-700"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {t === "configuration" ? "Configuration" : t === "breakdown" ? "Cost Breakdown" : "Route Map"}
                  </button>
                ))}
              </div>
```

- [ ] **Step 3: Gate the existing Cost Breakdown content and add the new tab panels**

Wrap the existing `CostBreakdownTable` block (and anything else that currently always renders in the results section — the total-cost card, benchmark chart, etc. can stay always-visible above the tab bar per the PRD's "Total trip cost" prominence, or move inside the "breakdown" tab; use judgment matching the current visual hierarchy, but the `CostBreakdownTable` component itself specifically belongs inside `{activeResultTab === "breakdown" && ( ... )}`) with a conditional. Add:

```tsx
              {activeResultTab === "configuration" && (
                <ConfigurationTab
                  truckId={result.meta.truck?.truck_id ?? ""}
                  modelId={result.meta.truck?.model_id}
                  overrides={configOverrides}
                  excludedHeads={excludedHeads}
                  onChange={(nextOverrides, nextExcluded) => {
                    setConfigOverrides(nextOverrides);
                    setExcludedHeads(nextExcluded);
                  }}
                />
              )}
              {activeResultTab === "route" && (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                  Route Map is coming in a future update.
                </div>
              )}
```

(Check `result.meta.truck`'s actual shape in this file's `CalculateResponse` interface — if it doesn't already carry `model_id`, that's fine, pass `undefined` for `modelId` in this task; wiring the actual selected model ID through to this tab is Task 5's job, not this task's.)

Add the two new state variables referenced above near `activeResultTab`:

```typescript
  const [configOverrides, setConfigOverrides] = useState<RateOverrides>({});
  const [excludedHeads, setExcludedHeads] = useState<CostHeadId[]>([]);
```

(Import `RateOverrides`, `CostHeadId` from `@/lib/zbc/types` at the top of the file if not already imported.)

- [ ] **Step 4: Run the type check**

Run: `npx tsc --noEmit`
Expected: clean (Task 5 wires live recompute; this task only needs the tab UI to compile and render without runtime errors).

- [ ] **Step 5: Manually verify in the browser**

```bash
npm run dev
```

Calculate a single trip, confirm the form auto-minimizes, confirm the three tabs appear and switching between them shows the right panel (Configuration shows the new form, Cost Breakdown shows the existing table, Route Map shows the placeholder).

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat(zbc): add Configuration/Cost Breakdown/Route Map tab bar with auto-minimize"
```

---

### Task 5: Live recompute — wire Configuration tab edits into the calculate flow

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `configOverrides`/`excludedHeads` state (Task 4), existing `handleCalculate`/calculate-API-call logic.
- Produces: no new interfaces — this task makes existing state changes actually trigger a recalculation.

- [ ] **Step 1: Add a debounced recompute effect**

In `app/page.tsx`, add a `useEffect` that watches `configOverrides` and `excludedHeads` and, after a short debounce (400ms), re-runs the same calculation the last successful "Calculate" used, but with the Configuration tab's edits merged in. Find how `handleCalculate` currently builds its request body (it should already merge `overrides` from the `TripForm` submission) and reuse that same request-building logic, adding `excluded_heads: excludedHeads` and merging `configOverrides` into whatever `overrides` object the last request used — do not build a second, divergent calculate function; extract the minimum shared piece if needed so both the "Calculate" button and this live-recompute effect go through the same code path.

```typescript
  useEffect(() => {
    if (!result || !lastRequestRef.current) return;
    const handle = setTimeout(() => {
      const merged = {
        ...lastRequestRef.current,
        overrides: { ...lastRequestRef.current.overrides, ...configOverrides },
        excluded_heads: excludedHeads,
      };
      handleCalculate(merged, { skipMinimize: true });
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configOverrides, excludedHeads]);
```

(Adapt to this file's actual existing request-storage pattern — if `handleCalculate` doesn't already store its last request in a ref, add one, e.g. `const lastRequestRef = useRef<CalculateRequest | null>(null);`, and set it at the top of `handleCalculate`. The `{ skipMinimize: true }` second argument prevents the live-recompute path from re-triggering Task 4's auto-minimize-on-success side effect when the form is already minimized — adapt `handleCalculate`'s signature to accept and respect this option.)

- [ ] **Step 2: Run the type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

Calculate a trip, switch to the Configuration tab, edit the driver rate — confirm the total on the Cost Breakdown tab updates within ~1 second without clicking Calculate again. Uncheck a fixed head's include checkbox — confirm its line disappears from the breakdown and the total drops.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(zbc): live-recompute the calculation when Configuration tab fields change"
```

---

### Task 6: Full verification

**Files:**
- No new source files. Verification only.

- [ ] **Step 1: Run the full type check**

Run: `npx tsc --noEmit`
Expected: zero errors, entire repository.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests passing.

- [ ] **Step 3: Browser-verify the full Configuration tab flow**

```bash
npm run dev
```

Calculate a single trip. On the Configuration tab: confirm every on-by-default field is pre-filled and shows a source badge where a model is selected; expand "Add more components" and confirm the six off-by-default fields appear; toggle a field's include checkbox off and confirm its cost breakdown line vanishes and the total recomputes; edit the return-load probability field and confirm the empty-return line changes; expand the truck-data reference table and confirm it shows the full raw profile.

- [ ] **Step 4: Confirm the auto-minimize doesn't break batch mode**

Switch to Batch Upload, run a batch calculation, confirm the form does NOT auto-minimize for batch (Task 4's auto-minimize should only fire on single-trip success, not batch — verify this explicitly, since the two flows share the same `formMinimized` state).

## Summary of what P2 does NOT include (explicitly deferred)

- Route Map tab content, TollGuru alternatives, Leaflet map, route/map downloads (Phase P4).
- Cost Breakdown tab redesign — grouped Fixed/Variable/Margin view, source-on-top display, derived metrics (Phase P3). This phase leaves the existing `CostBreakdownTable` as-is, just moved under a tab.
- Batch-mode tabs / per-row Configuration or Route Map (Phase P5).
- The `operating_days_per_month` field from the PRD's original text — see the Global Constraints note above for why this is a deliberate deviation, not an oversight.
