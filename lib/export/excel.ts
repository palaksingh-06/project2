import * as XLSX from "xlsx";

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
    origin: { name: string };
    destination: { name: string };
    fuel: { price_inr: number; state: string };
    toll: { plazas: number };
  };
}

export interface BatchRowResult extends CalculationResult {
  rowNum: number;
}

function buildRow(
  result: CalculationResult,
  extra: Record<string, string | number> = {}
): Record<string, string | number> {
  const row: Record<string, string | number> = {
    Origin: result.meta.origin.name,
    Destination: result.meta.destination.name,
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

export function downloadSingleTripExcel(
  result: CalculationResult,
  meta: { truckId: string }
): void {
  const row = buildRow(result, { "Truck ID": meta.truckId });
  const ws = XLSX.utils.json_to_sheet([row]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Trip Cost");
  XLSX.writeFile(wb, "zbc-trip.xlsx");
}

export function downloadBatchExcel(results: BatchRowResult[]): void {
  const sheetRows = results.map((r) =>
    buildRow(r, { "Row #": r.rowNum })
  );

  // Move Row # to front
  const reordered = sheetRows.map((r) => {
    const { "Row #": rowNum, ...rest } = r;
    return { "Row #": rowNum, ...rest };
  });

  const ws = XLSX.utils.json_to_sheet(reordered);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Batch Trip Cost");
  XLSX.writeFile(wb, "zbc-batch.xlsx");
}
