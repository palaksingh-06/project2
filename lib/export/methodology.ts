import truckRatesJson from "@/config/truck-rates.json";
import fallbackRatesJson from "@/config/fallback-rates.json";

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
  depreciation_per_km: number;
  maintenance_per_km: number;
  loading_per_ton: number;
  overhead_per_trip: number;
  risk_pct: number;
  empty_return_pct: number;
};

const TOLL_CLASS_LABELS: Record<string, string> = {
  lcv: "LCV",
  twoAxle: "2-Axle",
  threeAxle: "3-Axle",
  mav: "MAV (4-Axle)",
  fiveAxle: "5-Axle",
  car: "Car",
};

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function inr(v: number) {
  return `₹${v.toLocaleString("en-IN")}`;
}

function buildTruckTable(trucks: Record<string, TruckProfile>): string {
  const rows = Object.entries(trucks).map(([, t]) => t);

  const header = [
    "| Vehicle",
    "Payload",
    "Body",
    "Toll Class",
    "Rated Mileage (km/L)",
    "Effective Mileage (km/L)",
    "Driver Cost (₹/day)",
    "Bata (₹/trip)",
    "Night Halt (₹/night)",
    "Depreciation (₹/km)",
    "Maintenance (₹/km)",
    "Loading (₹/ton)",
    "Overheads (₹/trip)",
    "Risk",
    "Empty Return |",
  ].join(" | ");

  const separator =
    "| " +
    Array(15).fill("---").join(" | ") +
    " |";

  const dataRows = rows.map((t) =>
    [
      `| ${t.label}`,
      `${t.payload_tons}T`,
      t.body_type === "open" ? "Open" : "Closed",
      TOLL_CLASS_LABELS[t.toll_class] ?? t.toll_class,
      t.mileage_kmpl.toFixed(1),
      t.mileage_kmpl_considered.toFixed(2),
      inr(t.driver_per_day),
      inr(t.bata_per_trip),
      inr(t.night_halt_per_night),
      `₹${t.depreciation_per_km.toFixed(1)}`,
      `₹${t.maintenance_per_km.toFixed(1)}`,
      inr(t.loading_per_ton),
      inr(t.overhead_per_trip),
      pct(t.risk_pct),
      `${pct(t.empty_return_pct)} |`,
    ].join(" | ")
  );

  return [header, separator, ...dataRows].join("\n");
}

// Generates a static Markdown document explaining the ZBC calculation methodology.
// Content is derived from the actual formulas in lib/zbc/calculate.ts and
// live config values from config/truck-rates.json and config/fallback-rates.json.
export function generateMethodologyMd(): string {
  const trucks = truckRatesJson.trucks as Record<string, TruckProfile>;
  const fb = fallbackRatesJson;

  const dieselRows = Object.entries(fb.diesel_by_state)
    .map(([state, price]) => `| ${state} | ₹${price.toFixed(2)} |`)
    .join("\n");

  const tollRows = Object.entries(fb.toll_per_km)
    .map(([cls, rate]) => `| ${TOLL_CLASS_LABELS[cls] ?? cls} | ₹${rate.toFixed(2)} |`)
    .join("\n");

  return `# Zero-Based Costing — Calculation Methodology

## Overview

This tool calculates the full cost of a freight trip by summing **10 cost heads** from first principles. Every input is traceable to a data source shown in the "Sources" panel on each result.

---

## Distance & Route

1. **Geocoding** — Origin and destination addresses are resolved to coordinates (lat/lng) using:
   - Google Geocoding API (primary — most accurate for Indian street addresses)
   - OpenStreetMap Nominatim (fallback if Google limit is reached)
   - City cache (static config, last resort)
   - Progressive address stripping: if the full address fails, the leftmost comma-segment is dropped and the shorter address is retried.

2. **Road distance** — Computed from coordinates using:
   - Google Routes API (primary)
   - OpenRouteService OSRM (fallback)
   - Straight-line × road factor ${fb.road_factor} (last resort estimate)

---

## Cost Heads

All amounts are in **₹ (Indian Rupees)** and are for a **one-way laden trip** unless otherwise noted.

| # | Cost Head | Formula |
|---|-----------|---------|
| 1 | **Fuel** | (Distance ÷ Effective Mileage) × Diesel price |
| 2 | **Driver & Crew** | (Driver/day × Trip days) + Bata + (Night halt × (Days − 1)) |
| 3 | **Vehicle Cost** | Depreciation ₹/km × Distance  *(or flat hire charge if overridden)* |
| 4 | **Toll & Permits** | Actual FASTag toll + State permit override |
| 5 | **Maintenance & Tyres** | Maintenance ₹/km × Distance |
| 6 | **Loading & Unloading** | ₹/ton × Payload (tons) |
| 7 | **Overheads** | Fixed allocated amount per trip |
| 8 | **Risk & Variability** | Risk % × Subtotal (heads 1–7 + 9) |
| 9 | **Empty Return (Backhaul)** | Empty km × Variable ₹/km *(one-way trips = ₹0)* |

**Subtotal** = sum of heads 1–7 + 9 (excluding Risk)
**Total** = Subtotal + Risk

> **Trip days** = ⌈Distance ÷ (${truckRatesJson.avg_speed_kmh} km/h × 24 h)⌉, minimum 1.

---

## Mileage: Rated vs Effective

The **Rated Mileage** is the manufacturer/ideal figure. The **Effective Mileage** (used in calculations) applies a real-world efficiency factor (~70%) to account for road conditions, load weight, driver behaviour, and traffic.

## Cost-Sharing (Batch only)

When multiple rows share the same **route name**, they are treated as segments of one physical trip. The following cost heads are **divided equally by N** (number of rows on that route):

- Driver & Crew
- Vehicle Cost
- Maintenance & Tyres
- Loading & Unloading
- Overheads
- Empty Return

**Fuel** and **Toll** are kept per-segment (each hop burns its own diesel and crosses its own plazas). **Risk** is recomputed from the reduced subtotal.

> Example: Route "R-101" has 3 segments. Driver cost of ₹3,000 becomes ₹1,000 per segment.

---

## Toll Data

- **TollGuru API (primary)** — Real per-plaza FASTag rates for the exact route. Plaza count = actual number of plazas.
- **Fallback estimate** — Used when TollGuru is unavailable. Toll = ₹/km × distance (rates below). Plaza count = 0 (not real data).
- Trips under 30 km always get ₹0 toll under the fallback (no highway plazas on short intra-city hops).

### Fallback toll rates (₹/km)

| Vehicle Class | Rate (₹/km) |
|--------------|------------|
${tollRows}

---

## Diesel Price

State-wise diesel price (₹/L) is used when the origin state is identified. National default: **₹${fb.diesel_national_default_inr.toFixed(2)}/L**.

| State | Diesel Price |
|-------|-------------|
${dieselRows}
| *(all other states)* | ₹${fb.diesel_national_default_inr.toFixed(2)} |

---

## Empty Return (Backhaul)

For **two-way trips**, the return leg is costed using only the variable ₹/km applied to the empty return distance:

\`\`\`
Empty return cost = Empty km × (Fuel ₹/km + Maintenance ₹/km + Depreciation ₹/km)
\`\`\`

For **one-way trips**, empty return = ₹0.

---

## Benchmark Ranges

Each cost head is benchmarked against expected contribution ranges. A flag is shown if a head falls outside its normal band.

| Cost Head | Normal Min | Normal Max |
|-----------|-----------|-----------|
| Fuel | ${truckRatesJson.contribution_ranges.fuel.min}% | ${truckRatesJson.contribution_ranges.fuel.max}% |
| Driver & Crew | ${truckRatesJson.contribution_ranges.driver.min}% | ${truckRatesJson.contribution_ranges.driver.max}% |
| Vehicle Cost | ${truckRatesJson.contribution_ranges.vehicle.min}% | ${truckRatesJson.contribution_ranges.vehicle.max}% |
| Toll & Permits | ${truckRatesJson.contribution_ranges.toll.min}% | ${truckRatesJson.contribution_ranges.toll.max}% |
| Maintenance | ${truckRatesJson.contribution_ranges.maintenance.min}% | ${truckRatesJson.contribution_ranges.maintenance.max}% |
| Loading | ${truckRatesJson.contribution_ranges.loading.min}% | ${truckRatesJson.contribution_ranges.loading.max}% |
| Overheads | ${truckRatesJson.contribution_ranges.overhead.min}% | ${truckRatesJson.contribution_ranges.overhead.max}% |
| Risk | ${truckRatesJson.contribution_ranges.risk.min}% | ${truckRatesJson.contribution_ranges.risk.max}% |
| Empty Return | ${truckRatesJson.contribution_ranges.empty_return.min}% | ${truckRatesJson.contribution_ranges.empty_return.max}% |

---

## Truck Rate Card

Effective Mileage is the figure used in all fuel calculations.

${buildTruckTable(trucks)}

---

## Override Columns (Batch CSV / Excel)

Any rate can be overridden per-row in the upload file:

| Column | Description |
|--------|-------------|
| \`distance_km\` | Override the geocoded/routed distance (km) |
| \`mileage_kmpl\` | Override effective mileage (km/L) |
| \`driver_per_day\` | Driver cost per day (₹) |
| \`bata_per_trip\` | Bata allowance per trip (₹) |
| \`night_halt_per_night\` | Night halt cost per night (₹) |
| \`depreciation_per_km\` | Vehicle depreciation per km (₹) |
| \`vehicle_per_trip\` | Flat hire charge, replaces depreciation (₹) |
| \`state_permit\` | State permit / green tax (₹) |
| \`maintenance_per_km\` | Maintenance & tyres per km (₹) |
| \`loading_per_ton\` | Loading & unloading per ton (₹) |
| \`overhead_per_trip\` | Overhead allocated per trip (₹) |
| \`risk_pct\` | Risk fraction (0–1, e.g. 0.03 = 3%) |
| \`empty_return_pct\` | Empty return fraction of laden distance (0–1) |
| \`empty_km\` | Explicit empty return distance in km |

---

## Data Source Badges (Sources Panel)

| Badge | Meaning |
|-------|---------|
| **API** | Live data fetched from an external API (Google, TollGuru, etc.) |
| **Config** | Value from a static configuration file in the codebase |
| **Input** | Value provided directly by the user (coordinates, overrides) |
| **Estimate** | Calculated approximation when real data is unavailable |
| **Fallback** | Google API limit was reached; OSM or estimate was used instead |

---

*Generated by the ZBC Calculator. Config source files: \`config/truck-rates.json\`, \`config/fallback-rates.json\`.*
`;
}
