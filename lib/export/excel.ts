import * as XLSX from "xlsx-js-style";
import outletGeotags from "@/config/outlet-geotags.json";

// ── Outlet name lookup by coordinates ──────────────────────────────────────────
// The geocoder resolves coordinates to a coarse city name (e.g. "New Delhi").
// For the Excel output we instead want the actual outlet name from the geotag
// database. We match each origin/destination's lat/lng to the nearest known
// outlet within a small tolerance, and fall back to the geocoded name otherwise.
const OUTLETS = outletGeotags.outlets as { name: string; lat: number; lng: number }[];

// ~0.0025° ≈ 275m. Wide enough to absorb the 4-decimal rounding in the CSV
// coordinates, tight enough that two different outlets never collide.
const OUTLET_MATCH_TOLERANCE_DEG = 0.0025;

// Returns the name of the nearest outlet to the given coordinates, or null if
// none is within tolerance. Uses a cheap squared-degree distance (no need for
// true haversine at this scale — we only care about "is this the same point").
function lookupOutletName(lat?: number, lng?: number): string | null {
  if (lat === undefined || lng === undefined) return null;
  let best: { name: string; dist: number } | null = null;
  for (const o of OUTLETS) {
    const dLat = o.lat - lat;
    const dLng = o.lng - lng;
    const dist = dLat * dLat + dLng * dLng;
    if (best === null || dist < best.dist) best = { name: o.name, dist };
  }
  if (best && best.dist <= OUTLET_MATCH_TOLERANCE_DEG * OUTLET_MATCH_TOLERANCE_DEG) {
    return best.name;
  }
  return null;
}

// Resolves the display name for a trip endpoint: prefer the matched outlet name,
// otherwise fall back to whatever the geocoder resolved (city name).
function endpointName(endpoint: { name: string; lat?: number; lng?: number }): string {
  return lookupOutletName(endpoint.lat, endpoint.lng) ?? endpoint.name;
}

interface BreakdownRow {
  id: string;
  sno: number;
  name: string;
  amount_inr: number;
  pct: number;
}

interface CalculationResult {
  total: number;
  subtotal: number;
  breakdown: BreakdownRow[];
  // contributions is carried along but not used by the Excel export (UI only)
  contributions: unknown[];
  meta: {
    distance_km: number;
    trip_days: number;
    origin: { name: string; lat?: number; lng?: number };
    destination: { name: string; lat?: number; lng?: number };
    fuel: { price_inr: number; state: string };
    toll: { plazas: number };
  };
}

export interface BatchRowResult extends CalculationResult {
  rowNum: number;
  routeName?: string;
  truckLabel?: string;
}

function buildRow(
  result: CalculationResult,
  extra: Record<string, string | number> = {}
): Record<string, string | number> {
  const row: Record<string, string | number> = {
    Origin: endpointName(result.meta.origin),
    Destination: endpointName(result.meta.destination),
    "Distance (km)": result.meta.distance_km,
    "Trip Days": result.meta.trip_days,
    "Diesel (₹/L)": result.meta.fuel.price_inr,
    "Diesel State": result.meta.fuel.state,
    "Toll Plazas": result.meta.toll.plazas,
    ...extra,
  };

  const sorted = [...result.breakdown].sort((a, b) => a.sno - b.sno);
  for (const line of sorted) {
    row[`${line.name} (₹)`] = Math.round(line.amount_inr);
    row[`${line.name} (%)`] = line.pct;
  }

  row["Subtotal (₹)"] = Math.round(result.subtotal);
  row["Total (₹)"] = Math.round(result.total);

  return row;
}

// Applies presentation styling to a json_to_sheet worksheet:
//  - bold white-on-slate header row with borders
//  - thin borders on data cells, right-aligned numbers
//  - number formats: ₹ columns → #,##0, % columns → 0.0
//  - column widths sized to the longest cell in each column
// The `.s` style property is only honoured by xlsx-js-style (plain xlsx ignores it).
function styleSheet(ws: XLSX.WorkSheet, headers: string[]): void {
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  const thin = { style: "thin", color: { rgb: "D1D5DB" } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  // Start widths from the header text length; grow to fit data cells below.
  const widths = headers.map((h) => Math.max(10, Math.min(40, h.length + 2)));

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;
      const header = headers[C] ?? "";

      if (R === 0) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "334155" } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border,
        };
      } else {
        const isMoney = /\(₹\)$/.test(header) || header === "Diesel (₹/L)";
        const isPct = /\(%\)$/.test(header);
        cell.s = {
          border,
          alignment: { horizontal: typeof cell.v === "number" ? "right" : "left" },
        };
        if (isMoney) cell.z = "#,##0";
        if (isPct) cell.z = "0.0";
      }

      const len = String(cell.v ?? "").length + 2;
      if (len > widths[C]) widths[C] = Math.min(40, len);
    }
  }

  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!rows"] = [{ hpt: 24 }]; // taller header row
}

export function downloadSingleTripExcel(
  result: CalculationResult,
  meta: { truckId: string }
): void {
  const row = buildRow(result, { "Truck ID": meta.truckId });
  const ws = XLSX.utils.json_to_sheet([row]);
  styleSheet(ws, Object.keys(row));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Trip Cost");
  XLSX.writeFile(wb, "zbc-trip.xlsx");
}

export function downloadBatchExcel(results: BatchRowResult[]): void {
  const sheetRows = results.map((r) =>
    buildRow(r, {
      "Row #": r.rowNum,
      // Include route name (route number) and truck label near the front of the sheet
      ...(r.routeName ? { Route: r.routeName } : {}),
      ...(r.truckLabel ? { Truck: r.truckLabel } : {}),
    })
  );

  // Move Row #, Route, Truck to the front of every row
  const reordered = sheetRows.map((r) => {
    const { "Row #": rowNum, Route: route, Truck: truck, ...rest } =
      r as Record<string, string | number>;
    return {
      "Row #": rowNum,
      ...(route !== undefined ? { Route: route } : {}),
      ...(truck !== undefined ? { Truck: truck } : {}),
      ...rest,
    };
  });

  const ws = XLSX.utils.json_to_sheet(reordered);
  styleSheet(ws, Object.keys(reordered[0] ?? {}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Batch Trip Cost");
  XLSX.writeFile(wb, "zbc-batch.xlsx");
}
