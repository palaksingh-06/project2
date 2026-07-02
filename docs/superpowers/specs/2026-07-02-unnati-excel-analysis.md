# Unnati ZBC Excel — Full Method Analysis

**Source:** `data/Project Unnati_ZBC_Costing_Feb 15_v1.0 1.xlsx`
**Purpose:** Decode the actual costing logic (all sheets, all formulas) so the ZBC refactor PRD is
built on it, not on the PDF summary alone.

## Sheets
| Sheet | Role |
|---|---|
| ZBC-Main Page | User input (source, dest, one-way distance, truck, % onward load, % return load, toll) + final ZBC rate lookup |
| Input_Data | Per-truck raw inputs (price, salaries, mileage full/empty, tyres, oils/filters, speed, diesel, distances, net weight) |
| Guidelines | Global assumptions (salvage %, insurance rate, loan %, interest %, loan term, tyre/battery costs, turnaround/rest-time hours, uptime, overhead %, profit %) |
| Master Sheet | All derivations → per-year and per-km figures |
| ZBC-Calculations | Assembles per-km cost → per-ton-per-km → per-ton → per-trip, across return-load bands |
| Search Index | Lookup table (truck + return% → rates) feeding Main Page |
| Distance Matrix | City-to-city distances |
| Vehicle types | Tonnage / length / loadability per truck |

## Core structure — everything is ₹/km, amortized over ANNUAL km
```
Total ₹/km = Fixed/km + Fuel/km + Tyre/km + Maintenance/km + Overhead/km + Profit/km + Other/km
```
Then converted: per-ton-per-km → per-ton → per-trip, using one-way distance, net weight, and a
`(2 − return%)` leg factor.

### 1. Fixed cost/km  = (Σ annual fixed) ÷ annual km
Annual km = trips/month × one-way dist × 2 × 12 (from the utilization engine, §7). Components:

| Fixed component | Formula (annual) | Notes |
|---|---|---|
| **Depreciation** | `(Landed − Salvage) / 5 / 2` | Landed = chassis+reg + RC fitness + cabin/body. Salvage = 35% of landed. The `/5/2` = straight-line over 5 yrs, then halved (conservative half-value convention in this sheet). |
| **Crew salary** | `(Driver + Helper) × 12` | Helper 0 for small tempos. |
| **Insurance** | `avg of 5 yearly premiums`; premium = IDV × 2.5%; IDV declines by depreciation each year | Not a flat %. |
| **Permit & road tax** | direct annual input | |
| **Interest @ 11%** | **interest portion only** of an 80%-of-landed loan, 5-yr EMI (`PMT`), interest extracted per month, averaged/yr | **Principal is NOT a cost** — it's captured by depreciation. Only interest is expensed. |

> **Critical:** Unnati expenses **interest, not full EMI**. Full EMI + depreciation would double-count
> the asset (EMI principal repays the same value depreciation already writes off).

### 2. Fuel cost/km  (varies by load, uses full AND empty mileage)
Blended per km:
`(onward% / mileage_full × diesel + (1−onward%) / mileage_empty × diesel + return_band terms) / 2`
- Uses **full-load mileage** and **empty-load mileage** separately (Input_Data C16/C17).
- `% onward load` (Main Page C14) and the return-load band both feed it.

### 3. Tyre cost/km  (models retreading)
- Total life = new-tyre life + retreaded life; total cost = tyre cost + retread cost.
- Pairs needed/yr = annual_km / total_life × pairs; ×cost → annual tyre cost; ÷ annual km → ₹/km.

### 4. Maintenance/km  (bottom-up, itemized)
Each consumable = `qty × rate ÷ change_interval_km`:
- Engine oil, gearbox oil, axle oil, coolant, fuel filter, air filter, **battery** (cost ÷ life km),
  plus a flat **contingency = ₹0.10/km**. Summed = maintenance ₹/km.

### 5. Overhead/km  = **7%** × (Fixed/km + Fuel/km + Tyre/km + Maint/km)  — Guidelines C27
### 6. Profit/km    = **10%** × (same base)                                — Guidelines C28
### 7. Other/km     = (Tarpaulin + RTO/police/toll + loading/unloading) per trip ÷ (one-way dist × 2)

### Return-load & per-trip conversion
- Per-ton-per-km at band = `(2 − return%) × total_km_cost ÷ net_weight`. Empty return (0%) → ×2
  (both legs cost, one billed); full return (100%) → ×1.
- Bands modeled: 0 / 30 / 40 / 50 / 60 / 80 / 100 %.

### 8. Utilization engine (how idle/uptime is really handled)
This replaces any naive "÷30 days":
- **Trip duration (hrs)** = placement (2) + plant turnaround (4) + travel (dist÷speed, roundup) +
  client turnaround (4) + return-to-garage (4) + rest (8h per 16h worked) + [return-load wait 12h].
- **Trips/month** = `ROUNDDOWN(30×24 ÷ trip_duration × 0.9 uptime)`, capped so annual km ≤ input cap.
- **Annual km** = trips/month × dist × 2 × 12 → feeds every ₹/km denominator above.

## Global assumptions (Guidelines sheet)
Salvage 35% | Insurance 2.5% | Loan 80% | Interest 11% | Term 5 yrs | Tyre ₹40k/pair |
Retread ₹9k/pair | Battery ₹12k / 100,000 km | Rest 8h per 16h work | Uptime 90% |
Overhead 7% | Profit 10% | Threshold for rest add 150 km | Return-load wait 12h.

## Truck set (only 9 in Unnati)
Tempo 2T 3W, Tempo 2T 4W, Canter 4T, Canter 6.5T, Canter 8.5T, Truck 9T, Container 14T,
Turbo 15T, Tata 0.7T. (Our app already has 46 categories — far broader.)

---

## How Unnati differs from our current app AND from the draft PRD

| Topic | Unnati (authoritative) | Current app / draft PRD | Action |
|---|---|---|---|
| Cost basis | **₹/km, amortized over annual km** via uptime engine | Per-trip heads; PRD proposed ÷30×trip_days | **Decide** (see reconciliation) |
| Financing | **Interest only** (principal via depreciation) | PRD had **EMI** (double-counts) | **Fix → interest** |
| Overhead vs profit | **Both** separate markups (7% + 10%) | PRD folded overhead into fixed; single 10% margin | Align to Unnati |
| Depreciation | Straight-line landed−salvage `/5/2`; no terrain | PRD split aging/usage + terrain multiplier | Keep as labeled **enhancement** |
| Fuel | Full + empty mileage, blended by load | Single mileage | Adopt full/empty |
| Tyres | Retreading modeled | Simple n×cost/life | Adopt retreading |
| Maintenance | Itemized consumables bottom-up | Single ₹/km | Adopt itemized (richer data) |
| Return load | `(2 − return%)` leg factor + banded | empty_return_pct | Adopt Unnati factor |
| Utilization/idle | Trip-duration + 90% uptime engine | none / ÷30 | **Decide** |
| Route optimization | **absent** | new feature | Our addition (keep) |

---

## P0 Validation (post-implementation)

**Date:** 2026-07-02

Phase P0 (`docs/superpowers/plans/2026-07-02-p0-zbc-model-refactor.md`) implemented the hybrid model
decided in the PRD: driver/helper salary allocated by trip-days, all other fixed costs (depreciation
aging, insurance, road tax, fitness, interest) allocated via the Unnati-style annual-km utilization
engine, depreciation split into aging (fixed) + usage (variable, terrain-scaled), and overhead
(7%) + profit (10%) replacing the old single `risk_pct`. Ran through the full stack end-to-end via
Playwright against the live dev server (not just unit tests) to validate.

### Utilization engine sanity check

For a 500 km trip at the app's global `avg_speed_kmh` (45, not Unnati's 50), with a return load
assumed likely (uptime/wait logic engaged):

| Metric | This app (16T 6-Wheeler, 45 km/h) | Unnati worked example (Canter 6.5T, 50 km/h) |
|---|---|---|
| Trip duration | 46 hrs | 44 hrs |
| Trips/month (90% uptime, floor) | 14 | 14 |
| Annual km | **168,000** | **168,000** |
| Fixed ₹/km (depreciation-aging + insurance + road tax + fitness + interest) | ₹1.86/km | ₹2.62/km (different truck class — larger asset base) |

The two land on the identical `annual_km = 168,000` despite different truck class and average
speed — a coincidence of the floor() trip-count math, but a reassuring sanity check that the ported
engine behaves the same way Unnati's does: it isn't an approximation, it's the same formula shape
producing internally consistent numbers.

### Old model vs. new model (same truck, same inputs)

16T 6-Wheeler, Delhi round trip, 500 km, 16T payload, diesel ₹95.2/L, empty-return 20%:

| Cost head | Old model (risk_pct) | New model (overhead+profit) |
|---|---|---|
| Fuel | ₹12,364 | ₹12,364 (unchanged formula) |
| Driver | ₹1,450 | ₹1,450 (unchanged — already days-based) |
| Vehicle / Depreciation | ₹3,000 (flat ₹6/km) | ₹826 (usage) + ₹295 (aging) = ₹1,121 |
| Maintenance | ₹1,750 | ₹1,750 (unchanged) |
| Tyres | *(folded into maintenance)* | ₹900 (new, itemized) |
| Insurance / Road Tax / Fitness / Interest | *(folded into overhead ₹1,200 flat)* | ₹189 + ₹65 + ₹14 + ₹368 = ₹636 |
| Toll | ₹2,250 | ₹2,250 (unchanged) |
| Loading | ₹2,400 | ₹2,400 (unchanged) |
| Empty Return | ₹4,113 | ₹3,354 |
| Overhead | *(₹1,200 flat, folded above)* | ₹1,275 (7% of new base) |
| Risk / Profit | ₹571 (2% of subtotal) | ₹1,822 (10% of new base) |
| **Total** | **₹29,098** | **₹29,322** |

**Delta: +0.77%** for this specific truck/distance combination — much smaller than expected given
how structurally different the two models are. This is because the new model's itemization
(insurance/road-tax/fitness/interest, now properly annual-km-allocated instead of buried in a flat
₹1,200 overhead) happens to land close to what the old flat overhead was already approximating,
while the two-tier overhead(7%)+profit(10%) markup (17% combined) is meaningfully higher than the
old flat 2% risk — the two effects largely offset here. **This will not hold for every truck/distance
combination** — trucks with very different utilization profiles (short urban hops vs. long-haul) will
see larger swings, since the annual-km engine is now sensitive to trip duration in a way the old flat
per-trip overhead never was. Full validation against real freight data (`data/fist200b4prob.xlsx`)
is Phase P6's job, not P0's.

### End-to-end browser verification

- Single-trip flow (Delhi → Mumbai, Mini Truck 1T): all 15 default cost lines rendered correctly
  with formulas, amounts, %, and benchmark bands. Advanced-rates panel showed all new override
  fields (ex-showroom price, salvage %, helper ₹/day, overhead %, profit %). Zero console errors.
- Batch upload with 2 rows sharing a `route_name`: driver cost split from ₹1,000 (unshared baseline)
  to ₹500/row (confirmed via direct API call), matching Task 8's route cost-sharing logic exactly.
- Batch upload with the real 178-row Theobroma dataset: parsed and queued correctly (178/178 rows).
- Full test suite: **63/63 passing** (up from the original 45 — 18 new tests added across the
  utilization engine, calculator, cost-head provenance, and config getters; none of the original
  45 assertions were dropped).
- `npx tsc --noEmit`: **zero errors, entire repository** (confirmed independently, not just per-task).

### Outstanding for Phase P1/P6

`ex_showroom_inr`, `insurance_per_year`, `road_tax_per_year`, `fitness_per_year` are still P0
migration-script estimates (see `scripts/migrate-truck-rates.mjs`), not real per-model data.
`contribution_ranges` bands are placeholders. Both get refined once real truck data (Phase P1) and
real freight validation against `data/fist200b4prob.xlsx` (Phase P6) land.
