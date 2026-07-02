// ════════════════════════════════════════════════════════════════════════════
// Theobroma multi-stop route costing  —  REMOVABLE / MODEL-SPECIFIC
// ════════════════════════════════════════════════════════════════════════════
// This module implements a customer-specific costing rule on top of the standard
// per-row ZBC calculation. It is NOT general behaviour — it is intended only for
// the Theobroma route dataset.
//
// To DISABLE it entirely: set ROUTE_ADJUSTMENTS_ENABLED = false below.
// To REMOVE it entirely: delete this file and the single call to
//   applyRouteAdjustments(...) in app/api/calculate-batch/route.ts.
//
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
// ════════════════════════════════════════════════════════════════════════════

// Master on/off switch for this whole model-specific behaviour.
export const ROUTE_ADJUSTMENTS_ENABLED = true;

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

// Minimal structural shapes we touch — kept local so this file has no coupling to
// the wider result types and can be deleted cleanly.
interface AdjustableLine {
  id: string;
  amount_inr: number;
  pct: number;
  inputs?: Record<string, unknown>;
}
export interface AdjustableRow {
  routeName?: string;
  total: number;
  subtotal: number;
  breakdown: AdjustableLine[];
  meta: { distance_km: number };
}

function round(n: number, decimals = 0): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// Applies the model-specific adjustments to a batch of calculated rows in place
// and returns the same array. No-op when the feature flag is off.
export function applyRouteAdjustments<T extends AdjustableRow>(results: T[]): T[] {
  if (!ROUTE_ADJUSTMENTS_ENABLED) return results;

  // Group rows by route_name. Rows without a route_name are singleton groups
  // (divisor 1) so they behave exactly as before.
  const groups = new Map<string, T[]>();
  results.forEach((row, i) => {
    const key =
      row.routeName && row.routeName.trim()
        ? `route:${row.routeName.trim().toLowerCase()}`
        : `row:${i}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  });

  // Divide each route's shared heads by the number of rows (trips) that share
  // the same route_name. Each row gets its fixed costs divided by N.
  for (const group of groups.values()) {
    const n = group.length;
    for (const row of group) adjustRow(row, n);
  }

  return results;
}

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
