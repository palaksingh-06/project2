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
//   1. Route cost-sharing — all rows that share the same `route_name` are treated
//      as one physical trip. The per-trip / per-day cost heads (driver, vehicle,
//      maintenance, loading, idle, overhead, empty return) are counted ONCE for the
//      whole route and split equally across the number of DISTINCT OUTLETS the route
//      visits (N = unique origin/destination points, NOT the number of segment
//      rows), i.e. each row shows its head ÷ N. Fuel stays per-segment (each hop
//      burns its own diesel). Risk is a % of subtotal, so it is recomputed from the
//      reduced subtotal automatically (no separate division — that would double-count).
//   2. Short-hop toll rule — any trip under TOLL_FREE_BELOW_KM pays no toll.
// ════════════════════════════════════════════════════════════════════════════

// Master on/off switch for this whole model-specific behaviour.
export const ROUTE_ADJUSTMENTS_ENABLED = true;

// Trips shorter than this (km) are treated as toll-free.
const TOLL_FREE_BELOW_KM = 30;

// Cost heads that represent one trip's shared fixed cost and are therefore split
// equally across the route's stops. Fuel + Toll are intentionally excluded (they
// stay per-segment); Risk is excluded here because it is derived from subtotal and
// is recomputed afterwards.
const SPLIT_HEAD_IDS = new Set([
  "driver",
  "vehicle",
  "maintenance",
  "loading",
  "idle",
  "overhead",
  "empty_return",
]);

// Minimal structural shapes we touch — kept local so this file has no coupling to
// the wider result types and can be deleted cleanly.
interface AdjustableLine {
  id: string;
  amount_inr: number;
  pct: number;
  inputs?: Record<string, unknown>;
}
interface AdjustableRow {
  routeName?: string;
  total: number;
  subtotal: number;
  breakdown: AdjustableLine[];
  meta: {
    distance_km: number;
    // Endpoint coordinates — used to count the distinct outlets on a route.
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
  };
}

// A stable key for an endpoint so the same physical outlet referenced by several
// rows is counted once. 4 decimals ≈ 11 m, which collapses tiny coordinate drift.
function stopKey(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
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

  // Divide each route's shared heads by the number of DISTINCT OUTLETS it visits
  // (not the number of segment rows). All origins and destinations on the route
  // are pooled and deduped by coordinate to get that outlet count.
  for (const group of groups.values()) {
    const stops = new Set<string>();
    for (const row of group) {
      stops.add(stopKey(row.meta.origin));
      stops.add(stopKey(row.meta.destination));
    }
    const n = stops.size;
    for (const row of group) adjustRow(row, n);
  }

  return results;
}

// Adjusts a single row: applies the short-hop toll rule, splits shared heads by
// the route size `n`, then recomputes risk, subtotal, total and per-line %.
function adjustRow(row: AdjustableRow, n: number): void {
  const lines = row.breakdown;

  // ── 1. Short-hop toll rule ────────────────────────────────────────────────
  // Trips under the threshold incur no toll (local/intra-city movements).
  if (row.meta.distance_km < TOLL_FREE_BELOW_KM) {
    const toll = lines.find((l) => l.id === "toll");
    if (toll) toll.amount_inr = 0;
  }

  // ── 2. Split shared per-trip / per-day heads across the route's stops ──────
  if (n > 1) {
    for (const line of lines) {
      if (SPLIT_HEAD_IDS.has(line.id)) {
        line.amount_inr = round(line.amount_inr / n);
      }
    }
  }

  // ── 3. Recompute risk from the adjusted subtotal ──────────────────────────
  // Subtotal = every head except risk. Risk = subtotal × risk_pct, so it shrinks
  // in step with the split heads instead of being divided separately.
  const subtotal = lines
    .filter((l) => l.id !== "risk")
    .reduce((s, l) => s + l.amount_inr, 0);

  const riskLine = lines.find((l) => l.id === "risk");
  if (riskLine) {
    // Prefer the stored risk_pct; fall back to the original risk/subtotal ratio.
    const storedPct =
      typeof riskLine.inputs?.risk_pct === "number"
        ? (riskLine.inputs.risk_pct as number)
        : undefined;
    const prevSubtotal =
      typeof riskLine.inputs?.subtotal_inr === "number"
        ? (riskLine.inputs.subtotal_inr as number)
        : undefined;
    const riskPct =
      storedPct ??
      (prevSubtotal && prevSubtotal > 0
        ? riskLine.amount_inr / prevSubtotal
        : 0);
    riskLine.amount_inr = round(subtotal * riskPct);
    // Keep the stored subtotal input in sync for transparency.
    if (riskLine.inputs) riskLine.inputs.subtotal_inr = round(subtotal);
  }

  const risk = riskLine?.amount_inr ?? 0;
  const total = subtotal + risk;

  // ── 4. Write back totals and recompute each line's % of total ─────────────
  row.subtotal = round(subtotal);
  row.total = round(total);
  for (const line of lines) {
    line.pct = total > 0 ? round((line.amount_inr / total) * 1000) / 10 : 0;
  }
}
