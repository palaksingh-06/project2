# PRD — Zero-Based Costing Refactor & Route Optimization

**Date:** 2026-07-02
**Status:** Draft for approval
**Owner:** ZBC product (Protiviti — Theobroma engagement)
**Author:** Engineering

---

## 1. Purpose & Background

The current Zero-Based Costing (ZBC) tool estimates freight trip cost across 10 cost heads
for a single truck/route, plus a batch mode for up to 200 rows. Review against the reference
methodology (`data/Project Unnati_ZBC_Costing_Feb 15_v1.0 1.xlsx`) and industry ZBC practice
surfaced three problems:

1. **The cost model is not structured the way ZBC is supposed to be.** It does not separate
   **Fixed Cost → Variable Cost → Transporter Margin**. Fixed monthly costs (EMI, insurance,
   road tax, fitness, permits, GPS) are not itemized or allocated per trip — they are collapsed
   into a single `overhead_per_trip` figure. "Transporter margin" is represented only by a
   `risk_pct` line. This makes the output hard to defend to a client and impossible to configure
   the way the brief requires (include/exclude EMI, depreciation, salvage, etc.).

2. **Truck data is thin.** 46 truck *categories* exist, but not the *specific models* the client
   works with, and none of the fixed-cost inputs (EMI, insurance, road tax, fitness, tyre economics,
   depreciation/salvage) are captured per model.

3. **No route optimization.** Users cannot see route alternatives or trade cost vs. time vs. toll,
   and there is no in-app map.

This PRD covers a **model refactor + data enrichment + UI flow redesign + a new route-optimization
feature**, delivered test-first. It is a single PRD organized into phases; each phase produces its
own implementation plan.

### Non-negotiable constraints (from CLAUDE.md / prior decisions)
- **No new runtime dependency on a database.** Data stays in restructured, human-readable, git-diffable JSON.
- **Google API quota is file-based** (`.google-usage.json`) and only safe on a single always-on server.
  Any new Google API call must go through the existing `google-quota` gate. See §9.
- Keep working code working; minimal, targeted changes; match existing patterns.

---

## 2. Goals & Non-Goals

### Goals
- G1. Refactor the calculator into an explicit **Fixed + Variable + Margin** ZBC model with each
  fixed component itemized and individually **includable/excludable**.
- G2. Enrich truck data to **specific models** with per-model mileage, EMI, depreciation, salvage,
  insurance, road tax, fitness, GPS, tyre economics — each value **labeled real / proxy / estimate**.
- G3. Redesign the UI: keep the current two-column layout; add a **left-aligned tab bar above the
  right (results) column** — `Configuration · Cost Breakdown · Route Map`; auto-minimize the left
  input form on Calculate. Applies to single-trip **and** batch.
- G4. Show **data source (API/config/override) on top of every breakdown row** without a click,
  and show the exact numbers + formula in the row.
- G5. New **Route Map tab**: up to 3 route alternatives (hours / km / toll ₹), selectable, drawn on
  an in-page Leaflet/OpenStreetMap map, with **Download Map** and a **separate Route Excel**.
- G6. Improve **return-load probability** accuracy and validate ZBC output against real freights
  (`data/fist200b4prob.xlsx`). 
- G7. Test-driven throughout; existing 45 tests stay green.

### Non-Goals
- No database, no auth, no multi-tenant, no serverless migration.
- No route alternatives pre-computed for all 200 batch rows (on-demand per row only — see §7.4).
- No live per-model price feeds; truck economics are static JSON, refreshed manually.

---

## 3. Decisions Locked (from brainstorming)

| # | Decision |
|---|----------|
| D1 | One PRD, phased internally. |
| D2 | Storage: **JSON, restructured** (no MongoDB). |
| D3 | Specific model selection **changes the cost numbers** (per-model mileage/EMI/depreciation…). |
| D4 | UI redesign applies to **both** single-trip and batch. |
| D5 | Batch route alternatives are **lazy / on-demand per row**. |
| D6 | Route alternatives powered by **TollGuru `routes[]`** (toll + distance + duration + geometry per route, one call). Google Routes optional, off by default. |
| D7 | Map rendering: **Leaflet + OpenStreetMap tiles** (reuse existing export code). |
| D8 | Layout: current app layout kept; **tabs sit above the right results column, left-aligned**; left input form auto-minimizes on Calculate. |
| D9 | Data research depth: **best-effort real values + clearly-labeled proxies/estimates**. |
| D10 | **Hybrid fixed-cost allocation:** Driver salary and trip allowance use **days-based** (÷30×trip_days). All other fixed costs use **Unnati annual-km method** (annual fixed ÷ estimated annual km from uptime engine). |
| D11 | **Financing:** Expense **depreciation + interest only** (Unnati method). Interest extracted from declining-balance loan; principal captured via depreciation. No EMI as a cost. |
| D12 | **Overhead & Profit:** Two separate markups — overhead 7% + profit 10% — on the cost base (driver+fixed+variable). Both configurable. |
| D13 | Off-by-default fixed components live in a minimized **"Add more components"** section. |
| D14 | Depreciation is **split**: fixed aging line (annual-km via Unnati) + variable usage line (₹/km × terrain multiplier from `Plain`/`Hill` city data). |

---

## 4. Current State (as-is)

- **Single trip:** `app/page.tsx` → `POST /api/newcalculate` → `lib/newzbc/run-calculation.ts`
  orchestrates geocode → distance → toll + fuel → `calculateZBC()` → validate → provenance.
- **Batch:** `components/BatchUpload.tsx` → `POST /api/calculate-batch` → per-row calc +
  `applyRouteAdjustments` (Theobroma cost-sharing, flag-gated).
- **Calculator** (`lib/zbc/calculate.ts`): 10 heads — Fuel, Driver & Crew, Vehicle (depreciation),
  Toll & Permits, Maintenance & Tyres, Loading, Overheads, Risk (= % of subtotal), Empty Return.
  **No fixed/variable/margin split; EMI/insurance/road-tax/fitness/GPS not itemized.**
- **Providers:** Google Geocode/Routes (gated, currently off), Nominatim, ORS, TollGuru, Fuel Watch;
  all with config fallbacks. `google-quota.ts` enforces monthly caps via a local file.
- **Data:** `config/truck-rates.json` (46 categories), `config/truck-models.json` (a few ARAI models),
  `config/return-load-master.json` (513 cities with probability/terrain/hub/multiplier),
  `config/outlet-geotags.json`, `config/cities-cache.json`, `config/fallback-rates.json`.
- **Tests:** 45 vitest tests; `tsc --noEmit` clean.

---

## 5. Target Cost Model (the refactor)

### 5.1 Structure
```
Total Freight = Fixed-cost-per-trip + Variable Cost + Transporter Margin
```

**Fixed costs are split into two allocation methods:**

**1. Driver Salary (days-based allocation):**
```
Driver cost per trip = (monthly_driver_salary ÷ 30) × trip_days
```
- Simple and intuitive: drivers are paid per day/month they work.
- `trip_days` = trip duration in calendar days (distance ÷ avg speed, rounded up).
- All driver salary figures are **pre-filled** in the Configuration tab as an **editable form**;
  user can override and total recomputes live.

**2. Other Fixed Costs (annual-km allocation, Unnati method):**
All other fixed components (depreciation, insurance, road tax, fitness certificate, interest,
EMI service, RTO, tarpaulin, GPS, helper salary, etc.) are expressed as per-km figures:
```
Fixed ₹/km = Σ (annual component amounts) ÷ estimated_annual_km

estimated_annual_km = trips_per_month × one_way_distance × 2 × 12
trips_per_month = ROUNDDOWN(30×24 ÷ trip_duration_hours × 0.9_uptime, 0)
trip_duration_hours = travel + loading + turnarounds + rest + return_load_wait
```
- This is the **Unnati method**: prices idle time and utilization realistically via the
  trip-duration + 90% uptime engine. More transparent and defensible than arbitrary day divisors.
- Annual km is estimated at setup, not recalculated per trip.
- All annual component values are **pre-filled** in Configuration tab; user can override.

**Variable costs** scale with the trip (fuel, maintenance, tyres, loading, route tolls,
per-trip driver allowance, empty-return/backhaul).

**Overhead & Profit (two separate markups):**
```
Overhead ₹/km = 7% × (driver + other_fixed + variable) ₹/km
Profit ₹/km   = 10% × (same base)

Total Freight = Base Cost ₹ + Overhead % + Profit %
```
Both are configurable per trip or globally; this structure allows transparent cost recovery
and profit separation.

### 5.2 Fixed components (each individually toggleable)

All fixed components appear in the Configuration form. Components that are **on** by default show in
the main form; components that are **off** by default are hidden inside a minimized **"Add more
components"** section — the user expands it to add any of them (see §7.2). Toggling any component
recomputes the total live.

| Component | Allocation | Toggle default | Notes |
|---|---|---|---|
| **Driver salary (monthly)** | **Days** (÷30×trip_days) | on | Paid per day worked. Entry point for Configuration tab. |
| Helper/cleaner salary | **Days** (÷30×trip_days) | **off** | in "Add more components"; user can add |
| Driver trip allowance | **Days** (÷30×trip_days) | on | monthly treatment; per-trip treatment moves it to variable |
| Insurance | **Annual-km** (Unnati) | on | Annual cost ÷ annual km. |
| Road tax / permit | **Annual-km** (Unnati) | on | Annual allocation. |
| Fitness certificate | **Annual-km** (Unnati) | on | Annual allocation. |
| **Depreciation (aging)** | **Annual-km** (Unnati) | on | Straight-line `(ex_showroom − salvage) × aging_share ÷ life_years`, annualized, ÷ annual km. Time-based (accrues even idle). Per-model; excludable. See §5.3 for paired usage-based line. |
| **Interest (loan)** | **Annual-km** (Unnati) | on | Interest portion only (not principal). Per-model; excludable. |
| GPS charges | **Annual-km** (Unnati) | **off** | in "Add more components"; user can add |
| Toll-tag / FASTag service fee | **Annual-km** (Unnati) | **off** | in "Add more components"; monthly service fee (distinct from per-trip tolls) |
| RTO / misc | **Annual-km** (Unnati) | **off** | in "Add more components" |
| Tarpaulin | **Annual-km** (Unnati) | **off** | in "Add more components"; user can add |
| Salvage adjustment | **Annual-km** (Unnati) | on only if depreciation on | Reduces depreciable base. |
| Other fixed | **Annual-km** (Unnati) | **off** | in "Add more components"; user-defined |

### 5.3 Variable components
Fuel `(dist ÷ mileage × diesel)`, Maintenance `₹/km × dist`, **Tyres** `((n_tyres × cost)/tyre_life) × dist`
(new — currently folded into maintenance), **Depreciation (usage)** `(ex_showroom − salvage) × usage_share ÷ life_km × dist × terrain_multiplier`
(new — see below), route Tolls (TollGuru), Loading `₹/ton × payload`, Idle/waiting (optional),
Empty-return/backhaul adjusted by **return-load probability**.

> **Depreciation split (decided):** Depreciation is **two lines**, not one:
> - **Fixed — aging/obsolescence** (§5.2): time-based, allocated by trip-days ÷ `operating_days_per_month`.
>   Accrues even on idle days — this is how real-world Indian utilization (<5,000 km/month,
>   ~12 h idle per trip) gets priced in, alongside the `operating_days_per_month` divisor (§5.1).
> - **Variable — usage wear** (here): ₹/km, scaled by a **terrain multiplier** looked up from the
>   destination's `terrain` field in `config/return-load-master.json` (currently `Plain` / `Hill`
>   only). Default multipliers: `Plain = 1.0×`, `Hill = 1.4×` (source: `estimate`, tunable in P6).
> - `aging_share` + `usage_share` split the depreciable base between the two lines (default
>   60% aging / 40% usage — `estimate`, editable in Configuration tab); `aging_share + usage_share = 1`.
> - The Cost Breakdown tab shows both lines separately with their own source/formula (§7.3), and a
>   combined "Total Depreciation" for readability.
### 5.4 Derived metrics (surfaced in UI + Excel)
Freight per MT, Freight per loaded km, Freight per round-trip km, Freight per MT per loaded km.

### 5.5 Backward compatibility
- The refactor is additive: introduce a `fixed`/`variable`/`margin` grouping over cost lines.
- `risk_pct` is **repurposed/retired** in favour of an explicit margin; keep a mapping so existing
  configs and the 45 tests can be migrated deliberately (tests updated as part of the phase, not silently).
- Theobroma `route-adjustments.ts` cost-sharing stays behind its flag and is re-verified against the new grouping.

> **Open validation task:** reconcile line-by-line against the Unnati Excel and `fist200b4prob.xlsx`
> real freights; document any deltas and tuning in the phase plan.

---

## 6. Truck Data Model (JSON restructure)

### 6.1 Schema (per category → per model)
```jsonc
// config/truck-rates.json (category-level, unchanged keys + new fixed fields as class defaults)
// config/truck-models.json (expanded: array of specific models per category)
{
  "category_id": "25T_10W",
  "models": [
    {
      "model_id": "tata-prima-3523s",
      "label": "Tata Prima 3523.S",
      "image": "truck-images/25T_10W/tata-prima-3523s.png",
      "mileage_kmpl": { "value": 3.6, "source": "real" },
      "ex_showroom_inr": { "value": 4200000, "source": "proxy" },
      "driver_salary_per_month": { "value": 14000, "source": "estimate" },
      "helper_salary_per_month": { "value": 8000, "source": "estimate" },
      "salvage_pct": { "value": 0.2, "source": "estimate" },
      "life_years": { "value": 8, "source": "estimate" },
      "life_km": { "value": 800000, "source": "estimate" },
      "depreciation_aging_share": { "value": 0.6, "source": "estimate" },
      "depreciation_usage_share": { "value": 0.4, "source": "estimate" },
      "interest_per_year": { "value": 45000, "source": "estimate" },
      "insurance_per_year": { "value": 90000, "source": "proxy" },
      "road_tax_per_year": { "value": 48000, "source": "estimate" },
      "fitness_per_year": { "value": 4800, "source": "estimate" },
      "gps_per_month": { "value": 250, "source": "estimate" },
      "tyres": { "count": 10, "cost_per_tyre": 22500, "life_km": 75000, "source": "estimate" },
      "avg_speed_kmh": { "value": 50, "source": "estimate" }
    }
  ]
}
```
- **Every numeric field carries a `source`: `"real" | "proxy" | "estimate"`.** UI renders a small
  badge per field (legend: real = published/ARAI; proxy = derived from a real adjacent figure;
  estimate = class-based default).
- Model values **override** category defaults; missing model fields inherit the category.
- **Get as many specific models as possible** from `data/truck_images.jpg` and public sources —
  aim for full coverage of every model shown per category, not a token few.
- Images: crop each model from `data/truck_images.jpg` into `public/truck-images/<category>/<model>.png`.
- **Terrain multiplier for usage-based depreciation** (§5.3) is *not* per-model — it's a global
  lookup added to `config/fallback-rates.json`: `{ "terrain_depreciation_multiplier": { "Plain": 1.0, "Hill": 1.4 } }`,
  keyed by the destination's `terrain` field from `config/return-load-master.json`.

### 6.2 Coverage
Populate specific models shown in `data/truck_images.jpg` (~40–50 models across the existing
categories). Best-effort real mileage/price; labeled proxies/estimates elsewhere (D9).

---

## 7. UI / UX

### 7.1 Layout (per user's annotated screenshot)
- **Left column:** existing input form (Single Trip / Batch Upload), unchanged.
- **Right column:** a **left-aligned tab bar** across the top — `Configuration · Cost Breakdown · Route Map`.
- On **Calculate**, the left form **auto-collapses** to a thin `▸ Show input` strip (reusing the
  existing `formMinimized` mechanism, now automatic), right column takes full width.
- Truck picker in the input form shows the **model image** on selection.

### 7.2 Configuration tab
- **Pre-filled editable form** of all monthly fixed-cost figures + variable rates for the chosen
  model (driver salary, EMI, insurance, road tax, fitness, depreciation inputs, tyre economics, etc.).
  Values come pre-filled from the model data; user can change any field and the total recomputes live.
  Each value shows its **source badge** (real / proxy / estimate).
- On-by-default fixed components appear in the main form; off-by-default components live inside a
  minimized **"Add more components"** section (helper salary, GPS, FASTag fee, RTO/misc, tarpaulin,
  other) — expand to add any of them (§5.2).
- **`operating_days_per_month`** field (default 30) as the fixed-cost divisor (§5.1), editable.
- **Include/exclude toggle** per fixed component; toggling **recomputes live**.
- Minimized/expandable table of **all** truck data for the chosen model (like the Excel master tables).
- **Return-load probability** for the destination, auto-filled from `return-load-master.json`, editable.

### 7.3 Cost Breakdown tab
- Grouped as **Fixed / Variable / Margin → Total**, with derived metrics (§5.4).
- **Data source printed on top of each row** (no click needed) + exact numbers + formula inline.
- Keep the existing benchmark badges and optional chart.

### 7.4 Route Map tab
- **Up to 3 route alternatives** in a table: `hrs · km · toll ₹` (+ computed trip cost per route).
- **Leaflet + OSM** map inline; checking a route draws/updates its polyline (colour-coded).
- **Download Map** (self-contained HTML, reuse `lib/export/map.ts`) and **Download Route Excel**
  (new, separate from the ZBC Excel — route options, distances, durations, tolls, selected route).
- **Batch:** results table unchanged for speed; opening a specific row triggers **on-demand** route-alt
  fetch (D5) into the same Route Map tab UI.

### 7.5 Professional look
- Keep existing Tailwind design language; add source-badge legend, route-tradeoff table, map panel.

---

## 8. Route Optimization — Technical

- **New provider fn** `getRouteAlternatives(origin, dest, tollClass)` returning up to 3:
  `{ distance_km, duration_hours, toll_inr, geometry, provenance }[]`.
- **TollGuru is primary and sufficient (decided):** its `routes[]` response already carries, per
  alternative, toll cost + distance + duration + route **geometry** (polyline) — everything the
  Route Map tab needs, in one call. Read **all** routes, not just `[0]`.
- **Google Routes is optional and off by default:** `computeAlternativeRoutes` stays behind
  `GOOGLE_ROUTES_ENABLED` + `google-quota` for optional cross-check/nicer geometry. Not called on a
  normal lookup, so no extra billable call/quota use unless explicitly enabled.
- **Fallback:** if TollGuru unavailable, single ORS route + haversine estimate (no alternatives, flagged).
- Each route also gets a **full ZBC cost** so the table shows cost tradeoff, not just toll.
- Endpoint: `POST /api/routes` (single + per-row batch). Never called in the 200-row batch loop.

---

## 9. API Cost & Quota (must-read)
- Core route-alternatives feature uses **TollGuru only** — no Google call on a normal lookup.
- If Google Routes is ever enabled (optional cross-check), every call goes through
  `canCallGoogle` / `recordGoogleCall`.
- Batch on-demand only (D5) to avoid up-to-600 calls/upload.
- **Risk (from CLAUDE.md):** file-based cap only works on a single always-on server. If ever
  deployed to serverless/multi-instance, switch to shared storage or rely on the Google Cloud
  Console daily hard cap. Flagged, not fixed here.
- **Leaflet + OSM map needs no Google key.** Only the optional Google Routes cross-check requires
  the Routes API enabled on the key; verify before enabling and report to user first.

---

## 10. Return-Load Accuracy
- Re-tune `return-load-master.json` probabilities/multipliers against real-world lane behaviour and
  cross-check ZBC empty-return output vs. `data/fist200b4prob.xlsx`.
- Document methodology and any city-level overrides in the phase plan.

---

## 11. Phases & Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0** | Model refactor: Fixed/Variable/Margin, **hybrid fixed allocation** (driver/helper by trip-days; all other fixed costs by Unnati annual-km utilization engine), financing via interest+depreciation (not EMI), itemized fixed heads, tyre head, **split depreciation** (fixed aging via annual-km + variable usage × terrain multiplier), overhead (7%) + profit (10%) replace risk | New calc tested; deltas vs. Unnati documented; 45 tests migrated & green |
| **P1** | Truck data enrichment + schema + source labels + image crops | JSON validates; per-model overrides tested; images render |
| **P2** | UI: tabs above right column, auto-minimize, Configuration tab (checkboxes + live recompute + source badges) | Toggles recompute correctly; browser-verified at localhost |
| **P3** | Cost Breakdown tab: grouped view, source-on-top, derived metrics | Sources visible without click; metrics correct |
| **P4** | Route Map tab: TollGuru alternatives provider, `/api/routes`, Leaflet map, selection, Map + Route Excel downloads | 3 routes shown; map + excel download; TollGuru-primary, no Google call by default |
| **P5** | Batch parity: tabs + on-demand per-row route alternatives | Batch row opens route tab; no upfront alt calls |
| **P6** | Return-load tuning + validation vs. real freights | Documented accuracy comparison |

Each phase: TDD (`test-driven-development`), then browser verification at `localhost:3001`,
then its own implementation plan via `writing-plans`.

---

## 12. Testing Strategy
- **Unit:** new calc (fixed/variable/margin, days-based fixed allocation, operating-days divisor,
  each toggle, tyre head, split depreciation — aging line + usage line × terrain multiplier —
  margin), per-model override resolution, TollGuru route-alternatives parsing (all routes),
  route Excel builder, return-load lookup, terrain multiplier lookup (Plain/Hill).
- **Regression:** existing 45 tests migrated (not silently broken); `tsc --noEmit` clean.
- **Integration/browser:** single-trip flow, config toggles recompute, route selection updates map,
  both downloads, batch on-demand route open. Verified at `localhost:3001` per CLAUDE.md.
- **Validation:** ZBC totals vs. `fist200b4prob.xlsx` sample lanes.

---

## 13. Risks & Open Items
- R1. Real per-model economics are spotty → mitigated by source labels (D9); acceptable for deliverable.
- R2. Optional Google Routes cross-check may not be enabled on the key → verify only if enabling it;
  TollGuru-primary path and Leaflet map are unaffected (§9).
- R3. Margin-vs-risk migration could shift historical totals → document deltas, get sign-off in P0.
- R4. Serverless quota risk (CLAUDE.md) → flagged, out of scope.
- R5. Cropping 40–50 truck images from one sheet is manual/tedious → time-box; placeholder per model until cropped.

---

## 14. Deliverables
- Refactored calculator + itemized configurable ZBC model.
- Enriched `truck-rates.json` / `truck-models.json` + `public/truck-images/*`.
- Redesigned right-column tabbed UI (single + batch).
- Route Map tab + `/api/routes` + Leaflet map + Map/Route-Excel exports.
- Updated methodology export, tests, and this PRD's phase plans.
