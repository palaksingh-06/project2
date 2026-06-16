# Project Handoff

## Current Objective

Fix provenance (data-source tracking) so every badge in the ZBC tool honestly reflects
whether data came from a live API, a config fallback, or an estimate — and expose all
provenance in a right slide-in drawer per row instead of buried inside the Fuel breakdown row.

## Current Status

**Plan written, not yet implemented.** All exploration and design decisions are done.
Plan file: `C:\Users\bhavika.garg\.claude\plans\write-a-plan-to-nifty-thunder.md`

## Completed Since Last Session

- Walked through a full Karnal → Panipat (Bolero-Pickup, Route 10) cost calculation manually
  and verified numbers against web-scraped market rates (₹15–25/km for mini trucks, Haryana
  diesel ₹95.4–96/L vs config fallback of ₹90.2).
- Identified all provenance inaccuracies (see Open Issues below).
- Confirmed `OPENROUTESERVICE_API_KEY` is already set in `.env.local` → distance is already
  live ORS, but the badge is never displayed anywhere.
- Confirmed Vitest is the test runner (`npm run test`), one example test exists at
  `lib/utils/spellcheck.test.ts`, `@/` alias works in tests via `vitest.config.ts`.

## In Progress

Nothing — plan approved/ready to execute.

## Next Actions

Execute the plan in this order (each step is independently verifiable):

1. **Provenance type** — add `"input"` kind to `lib/zbc/provenance.ts` + badge colour (sky blue).
2. **Geocode split** — `lib/providers/geocode.ts`: tag lat/lng coords as `input · Provided coordinates`,
   reverse-geocoded name separately; cache hit as `config`; Nominatim as `api`.
3. **API toggles** — convert hardcoded `const GOOGLE_ROUTES_ENABLED = false` etc. in routing.ts,
   tolls.ts, geocode.ts to read `process.env.*` at call time (not module load). Add to `.env.example`.
4. **Truck resolution tier** — `lib/csv/parse-batch.ts`: `TruckResolution` gains `tier` field;
   `ValidatedRow` carries full `truckResolution`; passed through batch API to `meta.truck`.
5. **Cost-head provenance cleanup** — `lib/zbc/cost-head-provenance.ts`: remove the special-case Fuel
   composite (lines 39–51); flip `USER_OVERRIDE.kind` to `"input"`; drop `fuel` from the returned map.
6. **Remove inline sources** — `lib/zbc/run-calculation.ts`: stop emitting `breakdown[].sources`.
   `components/CostBreakdownTable.tsx`: remove `Source` badge component + all `sources?.*` refs.
7. **Type the response** — type `meta.inputs`, `meta.cost_heads`, `meta.truck` properly in
   `CalculationResponse`; mirror in `app/page.tsx` local interface.
8. **ProvenancePanel component** — `components/ProvenancePanel.tsx`: truck section, route inputs
   section (origin/dest/distance/toll/diesel each with `ProvenanceBadge showDetail`), cost-head rates.
9. **ProvenanceDrawer component** — `components/ProvenanceDrawer.tsx`: right-side overlay, slide
   transition, close on X / Esc / click-away; renders `ProvenancePanel`.
10. **Wire drawer into page** — `app/page.tsx` + `BatchResultsTable.tsx`: state for selected row,
    single-trip "View data sources" button, per-row "ⓘ Sources" button in batch table.
11. **Tests** — new test files for routing, tolls, fuel, geocode, cost-head-provenance, csv parse-batch.
12. **Browser verify** — run dev server, test single + batch, confirm badges match actual API paths.

## Open Issues

### Provenance bugs (the whole point of the plan)

| Bug | File | Line |
|---|---|---|
| lat/lng tagged green `api` when no API was called | `lib/providers/geocode.ts` | 273 |
| Fuel line shows `api` even when distance is an estimate | `lib/zbc/cost-head-provenance.ts` | 39–51 |
| Google Routes, TollGuru, Google Geocode hardcoded `false` — can't enable via env | `routing.ts`, `tolls.ts`, `geocode.ts` | each file |
| Truck model tier never recorded (no audit trail for alias/4-field/regex match) | `lib/csv/parse-batch.ts` | 169–266 |
| `DataSourcesPanel` exists but is rendered nowhere | `components/DataSourcesPanel.tsx` | — |
| Single-trip `CalculateResponse` interface strips `meta.inputs` + `cost_heads` | `app/page.tsx` | 18–33 |

### Known data accuracy issues (separate from provenance, noted for later)

- Diesel fallback in `config/fallback-rates.json` has Haryana at ₹90.2 — real price is ₹95.4–96/L.
  The live API (`energy.thecore.in`) is hit first; this only matters when that API is down.
- `road_factor` of 1.3 is fine for Haryana NH routes but may undercount for detour-heavy roads.

## Important Decisions

- **Drawer UX**: right slide-in drawer (not third column, not inline expand). User confirmed.
- **Provenance consolidation**: all provenance lives in the drawer only. No inline source badges in
  the breakdown table at all — not even on the Fuel row. User confirmed.
- **New `"input"` kind**: 4th provenance kind for user/CSV-supplied data (distinct sky-blue badge).
  Coordinates supplied in CSV = `input`, not `api`. User confirmed.
- **API toggles env-driven**: convert to `process.env` reads so real APIs run when a key is present.
  User confirmed. `OPENROUTESERVICE_API_KEY` is already in `.env.local`.
- **Route cost-sharing logic** (`lib/zbc/route-adjustments.ts`): intentional Theobroma-specific
  feature — split driver/vehicle/maintenance/loading/idle/overhead/empty_return by number of distinct
  outlet coords on the route. Toll stays per-segment. Fuel stays per-segment. Not broken.
- **Mileage multiplier**: all mileage values in `truck-rates.json` carry a `mileage_kmpl_considered`
  field = rated × 0.7 (load factor). When a model ID is resolved, `run-calculation.ts` applies ×0.7
  itself. This is correct and intentional.

## Modified Files

*(None yet — plan phase only.)*

## Useful Commands

```bash
npm run dev       # Start dev server at localhost:3001
npm run test      # Run Vitest unit tests
npm run build     # Type-check + production build
```

## Notes For Next Session

- Start by reading this file and the plan at
  `C:\Users\bhavika.garg\.claude\plans\write-a-plan-to-nifty-thunder.md`.
- The plan has numbered steps — execute them in order, verify each step in the browser or with
  tests before moving to the next.
- `OPENROUTESERVICE_API_KEY` is already in `.env.local`. After making toggles env-driven in Step 3,
  ORS should work immediately (no new keys needed for distance).
- TollGuru and Google Routes/Geocode still need keys if those paths are ever wanted.
- The `data/theobroma route data.csv` (178 rows, 32 routes) is the canonical test dataset for batch.
- Do **not** break existing working code: route-adjustments, CSV parsing, Excel export, and map
  generation are all working correctly and are not part of this plan.
