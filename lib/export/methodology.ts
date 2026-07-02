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
  maintenance_per_km: number;
  ex_showroom_inr: number;
  salvage_pct: number;
  interest_per_year: number;
  loading_per_ton: number;
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
> fleet uptime. See \`config/zbc-guidelines.json\` for the underlying constants.

---

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
Empty return cost = Empty km × (Fuel + Maintenance + Tyres + Depreciation (both lines)
                                 + Insurance + Road Tax + Fitness + Interest) ₹/km
\`\`\`

For **one-way trips**, empty return = ₹0.

---

## Benchmark Ranges

Each cost head is benchmarked against expected contribution ranges. A flag is shown if a head falls outside its normal band.

| Cost Head | Normal Min | Normal Max |
|-----------|-----------|-----------|
${Object.entries(truckRatesJson.contribution_ranges)
  .map(([id, r]) => `| ${id.replace(/_/g, " ")} | ${r.min}% | ${r.max}% |`)
  .join("\n")}

---

## Truck Rate Card

Effective Mileage is the figure used in all fuel calculations.

${buildTruckTable(trucks)}

---

## Override Columns (Batch CSV / Excel)

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
