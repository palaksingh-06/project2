"use client";

import { useEffect, useState } from "react";
import { ContributionBadge } from "@/components/ContributionBadge";
import type { ContributionCheck } from "@/lib/zbc/types";

interface TollPlaza {
  name: string;
  tag_inr: number;
  road?: string;
  state?: string;
}

export interface BreakdownRow {
  sno: number;
  id: string;
  name: string;
  formula: string;
  amount_inr: number;
  pct: number;
  inputs: Record<string, string | number>;
  toll_plazas?: TollPlaza[];
  sources?: Record<string, string>;
}

function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function Source({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
      <span>↗</span>{label}
    </span>
  );
}

function DetailPanel({ row }: { row: BreakdownRow }) {
  const { id, inputs, toll_plazas, sources } = row;

  if (id === "fuel") {
    return (
      <div className="space-y-2 text-xs text-slate-600">
        <div className="space-y-1">
          <p>
            <span className="text-slate-400">Road distance:</span>{" "}
            <strong>{inputs.distance_km} km</strong>{" "}
            {sources?.distance && <Source label={sources.distance} />}
          </p>
          <p>
            <span className="text-slate-400">Mileage:</span>{" "}
            <strong>{inputs.mileage_kmpl} km/l</strong>{" "}
            <Source label="truck-rates.json (ARAI real-world loaded)" />
          </p>
          <p>
            <span className="text-slate-400">Diesel price:</span>{" "}
            <strong>₹{inputs.diesel_inr}/L</strong>{" "}
            {sources?.diesel && <Source label={sources.diesel} />}
            {sources?.diesel_updated && (
              <span className="ml-1 text-slate-400">updated {sources.diesel_updated}</span>
            )}
          </p>
        </div>
        <p className="border-t border-slate-100 pt-2">
          {inputs.distance_km} km ÷ {inputs.mileage_kmpl} km/l = <strong>{inputs.liters} L</strong>{" "}
          × ₹{inputs.diesel_inr}/L = <strong>{formatInr(row.amount_inr)}</strong>
        </p>
      </div>
    );
  }

  if (id === "driver") {
    const nights = Math.max(0, Number(inputs.days) - 1);
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>Driver salary: ₹{inputs.driver_per_day}/day × {inputs.days} day{Number(inputs.days) > 1 ? "s" : ""} = <strong>{formatInr(Number(inputs.driver_per_day) * Number(inputs.days))}</strong></p>
        {inputs.bata_per_trip !== undefined && (
          <p>Bata allowance: <strong>{formatInr(Number(inputs.bata_per_trip))}</strong></p>
        )}
        {nights > 0 && inputs.night_halt_per_night !== undefined && (
          <p>Night halt: ₹{inputs.night_halt_per_night} × {nights} night{nights > 1 ? "s" : ""} = <strong>{formatInr(Number(inputs.night_halt_per_night) * nights)}</strong></p>
        )}
        <p className="border-t border-slate-100 pt-1 text-slate-400">Rates from AITWA 2024 wage guidelines</p>
      </div>
    );
  }

  if (id === "vehicle") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        {inputs.depreciation_per_km !== undefined
          ? <p>₹{inputs.depreciation_per_km}/km × {inputs.distance_km} km = <strong>{formatInr(row.amount_inr)}</strong></p>
          : <p>Hire charge per trip: <strong>{formatInr(row.amount_inr)}</strong></p>
        }
        <p className="text-slate-400">Covers truck depreciation + financing cost spread over lifetime km</p>
      </div>
    );
  }

  if (id === "toll") {
    if (toll_plazas && toll_plazas.length > 0) {
      return (
        <div className="space-y-2 text-xs">
          <p className="flex items-center gap-2 text-slate-500">
            {toll_plazas.length} FASTag plaza{toll_plazas.length > 1 ? "s" : ""}
            {sources?.toll && <Source label={sources.toll} />}
          </p>
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1 pr-4 font-normal">Plaza</th>
                <th className="pb-1 pr-4 font-normal">Road</th>
                <th className="pb-1 pr-4 font-normal">State</th>
                <th className="pb-1 text-right font-normal">FASTag ₹</th>
              </tr>
            </thead>
            <tbody>
              {toll_plazas.map((p, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-4 text-slate-700">{p.name}</td>
                  <td className="py-1 pr-4 text-slate-500">{p.road ?? "—"}</td>
                  <td className="py-1 pr-4 text-slate-500">{p.state ?? "—"}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{formatInr(p.tag_inr)}</td>
                </tr>
              ))}
              {inputs.permit !== undefined && Number(inputs.permit) > 0 && (
                <tr className="border-t border-slate-200">
                  <td className="py-1 pr-4 text-slate-600 italic" colSpan={3}>State permit (override)</td>
                  <td className="py-1 text-right font-medium tabular-nums">{formatInr(Number(inputs.permit))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p className="flex items-center gap-2">
          Toll estimate {sources?.toll && <Source label={sources.toll} />}
        </p>
        <p>₹{Math.round(row.amount_inr / (Number(inputs.distance_km) || 1))}/km × {Number(inputs.distance_km).toFixed(0)} km = <strong>{formatInr(row.amount_inr)}</strong></p>
        {inputs.permit !== undefined && Number(inputs.permit) > 0 && (
          <p>+ State permit: {formatInr(Number(inputs.permit))}</p>
        )}
      </div>
    );
  }

  if (id === "maintenance") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>₹{inputs.per_km}/km × {inputs.distance_km} km = <strong>{formatInr(row.amount_inr)}</strong></p>
        <p className="text-slate-400">Tyre wear + servicing — TCI fleet operations benchmark</p>
      </div>
    );
  }

  if (id === "loading") {
    return (
      <div className="text-xs text-slate-600">
        <p>{inputs.payload_tons} tons × ₹{inputs.per_ton}/ton = <strong>{formatInr(row.amount_inr)}</strong></p>
        <p className="mt-0.5 text-slate-400">Labour at origin + destination — North India mandi/plant rates</p>
      </div>
    );
  }

  if (id === "idle") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>{inputs.hours} hours × ₹{inputs.per_hour}/hour = <strong>{formatInr(row.amount_inr)}</strong></p>
        <p className="text-slate-400">Loading dock waits, weighbridge queues, border delays — NITI Aayog detention benchmark</p>
      </div>
    );
  }

  if (id === "overhead") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>Fixed per trip: <strong>{formatInr(Number(inputs.per_trip))}</strong></p>
        <p className="text-slate-400">GPS + admin + insurance allocation + driver phone</p>
      </div>
    );
  }

  if (id === "risk") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>{(Number(inputs.risk_pct) * 100).toFixed(1)}% of {formatInr(Number(inputs.subtotal_inr))} subtotal = <strong>{formatInr(row.amount_inr)}</strong></p>
        <p className="text-slate-400">Cargo insurance, pilferage, transit damage buffer</p>
      </div>
    );
  }

  if (id === "empty_return") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>{(Number(inputs.empty_pct) * 100).toFixed(0)}% of {inputs.distance_km} km = <strong>{inputs.empty_km} km driven back empty</strong></p>
        <p>{inputs.empty_km} km × ₹{inputs.variable_per_km}/km variable cost = <strong>{formatInr(row.amount_inr)}</strong></p>
        <p className="text-slate-400">Variable cost = fuel + maintenance + depreciation per km</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600">
      {Object.entries(inputs).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-slate-400">{k.replace(/_/g, " ")}</span>
          <span>{typeof v === "number" && v > 100 ? formatInr(v) : v}</span>
        </div>
      ))}
    </div>
  );
}

export function CostBreakdownTable({
  rows,
  contributions,
  showContribution,
}: {
  rows: BreakdownRow[];
  contributions: ContributionCheck[];
  showContribution: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-expand all rows when printing, restore state after print dialog closes
  useEffect(() => {
    const expand = () => setExpandedId("__ALL__");
    const restore = () => setExpandedId(null);
    window.addEventListener("beforeprint", expand);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", expand);
      window.removeEventListener("afterprint", restore);
    };
  }, []);

  const contribMap = new Map(contributions.map((c) => [c.id, c]));
  const colSpan = showContribution ? 6 : 5;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Cost head</th>
            <th className="px-4 py-3">Basis</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3 text-right">%</th>
            {showContribution && <th className="px-4 py-3">Benchmark</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const c = contribMap.get(row.id as ContributionCheck["id"]);
            const isExpanded = expandedId === "__ALL__" || expandedId === row.id;

            return (
              <>
                <tr
                  key={row.id}
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-400">{row.sno}</td>
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400">{isExpanded ? "▾" : "▸"}</span>
                      {row.name}
                    </span>
                  </td>
                  <td className="max-w-[180px] px-4 py-3 text-slate-600">{row.formula}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatInr(row.amount_inr)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{row.pct}%</td>
                  {showContribution && c && (
                    <td className="px-4 py-3">
                      <ContributionBadge status={c.status} pct={c.pct} range={c.range} />
                    </td>
                  )}
                </tr>
                {isExpanded && (
                  <tr key={`${row.id}-detail`} className="border-b border-slate-100 bg-slate-50">
                    <td />
                    <td colSpan={colSpan - 1} className="px-4 py-3">
                      <DetailPanel row={row} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
