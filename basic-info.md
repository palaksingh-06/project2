# Zero Based Costing Calculator — How It Works

## The Big Picture

This app takes **truck type + origin + destination + payload** and returns **₹X total trip cost, broken into 10 cost heads**.

Everything happens in one POST request. The frontend sends the inputs, the server does all the work, and the frontend renders what comes back.

---

## Full Data Flow

### Step 1 — User fills the form
**File:** `components/TripForm.tsx`

The left panel on the UI. User picks:
- **Truck type** — one of 4 classes (9T LCV, 16T 2-axle, 25T 3-axle, 32T MAV)
- **Truck model** — optional, unlocks ARAI-certified mileage for that specific model
- **Origin city** — e.g. Delhi
- **Destination city** — e.g. Mumbai
- **Payload (tons)** — how much cargo is loaded
- **Advanced overrides** — optional manual values for any rate (mileage, driver salary, etc.)

When the user clicks Calculate, `TripForm` passes a `CalculateRequest` object up to `page.tsx`.

---

### Step 2 — Main page sends the API call
**File:** `app/page.tsx`

`HomePage()` holds state for the result. It sends a `fetch` POST to `/api/calculate` with the form data. When the response comes back, it stores it in state and shows the results panel on the right.

---

### Step 3 — API route orchestrates everything
**File:** `app/api/calculate/route.ts` → `POST()` function

This is the brain. It runs in this exact order:

#### 3a. Validate input
Uses **Zod** to check all required fields. Returns `400 Bad Request` if anything is wrong.

#### 3b. Get the truck profile
```
getTruckProfile(truckId)  →  lib/config.ts
```
Reads `config/truck-rates.json` and returns the benchmark rates for that truck class — mileage, driver salary, maintenance rate, depreciation, etc.

#### 3c. Geocode origin and destination (runs in parallel)
```
geocode("Delhi")  →  lib/providers/geocode.ts
```
**Geocoding** = turning a city name into coordinates (lat/lng).

Two steps, in order:
1. **Cache first** — checks `config/cities-cache.json` (154 Indian cities pre-stored). Instant, no API call.
2. **Nominatim fallback** — if city not in cache, calls OpenStreetMap's free geocoding API.

Returns: `{ lat, lng, name, state, provenance }`

#### 3d. Get road distance
```
getRouteDistance(originCoords, destCoords)  →  lib/providers/routing.ts
```
Calls **OpenRouteService (ORS)** — a free routing API. Sends the two lat/lng pairs, gets back actual road distance in km (not straight-line). Uses the `driving-car` profile.

Returns: `{ distance_km, provenance }`

#### 3e. Get toll data and diesel price (runs in parallel)
```
getTollEstimate(...)   →  lib/providers/tolls.ts
getDieselPrice(state)  →  lib/providers/fuel.ts
```

**Tolls:**
- Primary: **TollGuru API** — returns total FASTag cost + list of individual plazas with names and costs
- Fallback: `₹/km × distance` from `config/fallback-rates.json` (used when TollGuru fails or quota is exhausted)

**Diesel price:**
- Primary: **The Core Fuel Watch** — free Indian fuel price API, state-level prices
- Fallback 1: Hardcoded state prices in `config/fallback-rates.json`
- Fallback 2: National average (₹92.5/L)

#### 3f. Calculate all 10 cost heads
```
calculateZBC(inputs)  →  lib/zbc/calculate.ts
```
Pure arithmetic — no external calls. Takes all collected data and computes:

| # | Cost Head | Formula |
|---|---|---|
| 1 | Fuel | `(distance ÷ mileage) × diesel_price` |
| 2 | Driver & Crew | `driver_per_day × days + bata + night_halts` |
| 3 | Vehicle Cost | `depreciation_per_km × distance` |
| 4 | Toll & Permits | TollGuru total + state permit override |
| 5 | Maintenance & Tyres | `maintenance_per_km × distance` |
| 6 | Loading & Unloading | `loading_per_ton × payload_tons` |
| 7 | Idle / Waiting | `idle_hours × cost_per_hour` |
| 8 | Overheads | Fixed per trip (GPS, admin, insurance) |
| 9 | Risk & Variability | `subtotal × risk_pct` |
| 10 | Empty Return | `empty_km × variable_cost_per_km` |

Returns: `{ lines[], subtotal_inr, total_inr, trip_days }`

#### 3g. Validate contributions
```
validateContributions(result)  →  lib/zbc/validate.ts
```
Each cost head has an expected % range (from `config/truck-rates.json → contribution_ranges`). This checks if each head's actual % is within range. Returns `status: "ok" | "low" | "high"` — shown as coloured badges in the UI.

#### 3h. Build provenance labels
```
buildCostHeadProvenance(...)  →  lib/zbc/cost-head-provenance.ts
```
Creates human-readable labels per cost head telling you where the data came from — e.g. "ORS (API)" vs "config file" vs "user override". Shown as small chips in the expandable detail panels.

#### 3i. Return response
Single JSON object with:
- `total` — grand total in ₹
- `breakdown[]` — 10 rows, each with amount, %, formula, inputs, sources, toll plazas
- `contributions[]` — ok/low/high status per head
- `meta` — trip days, distance, origin/dest names, fuel price, toll plaza count
- `warnings[]` — which providers fell back to estimates

---

### Step 4 — Frontend renders results
**Files:** `app/page.tsx`, `components/CostBreakdownTable.tsx`, `components/BreakdownChart.tsx`

`page.tsx` passes the API response to three display components:

- **`BreakdownChart.tsx`** — donut/bar chart showing each cost head as a slice of the total
- **`CostBreakdownTable.tsx`** — 10-row table; each row is clickable and expands a detail panel showing the exact calculation with source labels (e.g. "Road distance: 1345 km [↗ OpenRouteService]")
- **`ContributionBadge.tsx`** — coloured badge per row (green = in range, red/orange = anomaly)

---

## Config Files — Where All Defaults Live

| File | Purpose |
|---|---|
| `config/truck-rates.json` | Benchmark rates per truck class (mileage, driver salary, maintenance, etc.) + expected % ranges |
| `config/fallback-rates.json` | Toll per km, diesel by state, plazas per 100km — used when APIs fail |
| `config/cities-cache.json` | Pre-stored lat/lng for 154 Indian cities |
| `config/truck-models.json` | ARAI-certified mileage per specific truck model |
| `.env.local` | API keys — ORS, TollGuru (never committed to git) |

---

## Key Files — One Line Each

| File | Does what |
|---|---|
| `app/page.tsx` | Glues UI together, holds state, makes the API call |
| `app/api/calculate/route.ts` | Orchestrates all providers, calls calculator, builds response |
| `lib/zbc/calculate.ts` | Pure math — 10 formulas, no external calls |
| `lib/zbc/validate.ts` | Checks if cost %s are in expected ranges |
| `lib/zbc/types.ts` | TypeScript interfaces shared across all files |
| `lib/providers/geocode.ts` | City name → lat/lng (cache → Nominatim) |
| `lib/providers/routing.ts` | lat/lng → road distance km (ORS) |
| `lib/providers/tolls.ts` | Route → FASTag toll cost (TollGuru → fallback) |
| `lib/providers/fuel.ts` | State → diesel price (Fuel Watch API → fallback) |
| `lib/config.ts` | Reads config files, exposes helper functions |
| `components/TripForm.tsx` | Left panel — user inputs |
| `components/CostBreakdownTable.tsx` | Right panel — 10 cost rows, clickable detail panels |
| `components/BreakdownChart.tsx` | Donut/bar chart |

---

## External APIs Used

| API | What for | Fallback |
|---|---|---|
| OpenRouteService (ORS) | Road distance (km) | Straight-line × road factor |
| TollGuru | FASTag toll cost per route + per plaza | ₹/km × distance |
| The Core Fuel Watch | Live state-wise diesel price | Config file → national average |
| OpenStreetMap Nominatim | Geocoding (city → lat/lng) | Cities cache |
