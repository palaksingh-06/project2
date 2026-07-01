"use client";

import { useState } from "react";
import { CostBreakdownTable } from "@/components/CostBreakdownTable";
import { downloadBatchExcel } from "@/lib/export/excel";
import type { BatchRowResult } from "@/lib/export/excel";
import { generateRouteMapHtml } from "@/lib/export/map";
import type { ContributionCheck } from "@/lib/zbc/types";
import type { BreakdownRow } from "@/components/CostBreakdownTable";

// Re-export type so page.tsx can import it from one place
export type { BatchRowResult };

function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

interface BatchResultsTableProps {
  results: BatchRowResult[];
  apiErrors?: Array<{ rowNum: number; error: string }>;
  onShowProvenance?: (result: BatchRowResult) => void;
}

export function BatchResultsTable({ results, apiErrors = [], onShowProvenance }: BatchResultsTableProps) {
  // Track which row is expanded to show the full CostBreakdownTable
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showContribution, setShowContribution] = useState(true);

  // Grand total across all successfully calculated trips
  const grandTotal = results.reduce((sum, r) => sum + r.total, 0);
  const grandMarketRate = results.reduce(
    (sum, r) => sum + (r.market_rate_estimate_inr ?? r.total),
    0
  );

  // Download the route map — only enabled when at least one result has a routeName and lat/lng
  const hasMapData = results.some(
    (r) => r.routeName && r.meta.origin.lat != null && r.meta.destination.lat != null
  );

  function handleDownloadMap() {
    const html = generateRouteMapHtml(results);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "route-map.html";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Export toolbar */}
      <div className="flex items-center justify-between" data-print="hide">
        <p className="text-sm font-medium text-slate-700">
          {results.length} trip{results.length > 1 ? "s" : ""} calculated
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => downloadBatchExcel(results)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Download Excel
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Print / PDF
          </button>
          {/* Download Map — only visible when at least one row has a route_name and geocoded coordinates */}
          <button
            onClick={handleDownloadMap}
            disabled={!hasMapData}
            title={hasMapData ? "Download an interactive route map" : "Add route_name column to your CSV to enable this"}
            className="rounded-lg border border-violet-400 bg-violet-50 px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Download Map
          </button>
        </div>
      </div>

      {/* Benchmark toggle */}
      <label className="flex items-center gap-2 text-sm text-slate-600" data-print="hide">
        <input
          type="checkbox"
          checked={showContribution}
          onChange={(e) => setShowContribution(e.target.checked)}
        />
        Show benchmark check
      </label>

      {/* Summary table — one row per trip */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Origin → Destination</th>
              <th className="px-4 py-3">Distance</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3 text-right">ZBC ₹</th>
              <th className="px-4 py-3 text-right">Market Rate Est. ₹</th>
              {/* Extra column header for provenance button — only rendered when handler is provided */}
              {onShowProvenance && <th className="px-2 py-3 text-right">Sources</th>}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const isExpanded = expandedRow === r.rowNum;
              return (
                <>
                  {/* Summary row — click to expand detailed breakdown */}
                  <tr
                    key={r.rowNum}
                    onClick={() => setExpandedRow(isExpanded ? null : r.rowNum)}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-400">{r.rowNum}</td>
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">{isExpanded ? "▾" : "▸"}</span>
                        {r.meta.origin.name} → {r.meta.destination.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.meta.distance_km} km</td>
                    <td className="px-4 py-3 text-slate-600">{r.meta.trip_days}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatInr(r.total)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.market_rate_estimate_inr !== undefined ? (
                        <span title={
                          r.return_load?.match_level === "state"
                            ? `State avg · ${r.return_load.return_probability_pct}% return prob · ${r.return_load.multiplier}× · ${r.return_load.matched_city}`
                            : `${r.return_load?.return_probability_pct ?? "?"}% return prob · ${r.return_load?.multiplier ?? "?"}× · ${r.return_load?.hub ?? ""}`
                        }>
                          {formatInr(r.market_rate_estimate_inr)}
                          {r.return_load?.match_level === "state" && (
                            <span className="ml-1 text-xs text-slate-400">~</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400" title="City not in master — showing raw ZBC">
                          {formatInr(r.total)}
                        </span>
                      )}
                    </td>
                    {/* ⓘ button — stops row expand-click propagation */}
                    {onShowProvenance && (
                      <td className="px-2 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); onShowProvenance(r); }}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                          title="View data sources for this row"
                        >
                          Sources
                        </button>
                      </td>
                    )}
                  </tr>

                  {/* Expanded detail row — full 10-cost-head breakdown */}
                  {isExpanded && (
                    <tr key={`${r.rowNum}-detail`} className="border-b border-slate-100 bg-slate-50">
                      <td />
                      <td colSpan={4} className="px-4 py-4">
                        <div className="mb-2 text-xs text-slate-500">
                          Diesel ₹{r.meta.fuel.price_inr}/L ({r.meta.fuel.state}) · {r.meta.toll.plazas} toll plaza{r.meta.toll.plazas !== 1 ? "s" : ""}
                        </div>
                        <CostBreakdownTable
                          rows={r.breakdown as BreakdownRow[]}
                          contributions={r.contributions as ContributionCheck[]}
                          showContribution={showContribution}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}

            {/* Grand total row */}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td colSpan={4} className="px-4 py-3 text-slate-600">Grand Total ({results.length} trips)</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInr(grandTotal)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInr(grandMarketRate)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Failed rows section — shown if any API-level errors occurred */}
      {apiErrors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-sm font-medium text-red-700">
            {apiErrors.length} trip{apiErrors.length > 1 ? "s" : ""} could not be calculated:
          </p>
          <ul className="space-y-1 text-sm text-red-800 list-disc list-inside">
            {apiErrors.map((e, i) => (
              <li key={i}>Row {e.rowNum}: {e.error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
