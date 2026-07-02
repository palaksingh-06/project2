"use client";

import { useEffect, useState, Fragment } from "react";
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
}

function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function DetailPanel({ row }: { row: BreakdownRow }) {
  const { id, inputs, toll_plazas } = row;

  if (id === "fuel") {
    return (
      <div className="space-y-2 text-xs text-slate-600">
        <div className="space-y-1">
          <p>
            <span className="text-slate-400">Road distance:</span>{" "}
            <strong>{inputs.distance_km} km</strong>
          </p>
          <p>
            <span className="text-slate-400">Mileage:</span>{" "}
            <strong>{inputs.mileage_kmpl} km/l</strong>
          </p>
          <p>
            <span className="text-slate-400">Diesel price:</span>{" "}
            <strong>₹{inputs.diesel_inr}/L</strong>
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

  if (id === "toll") {
    if (toll_plazas && toll_plazas.length > 0) {
      return (
        <div className="space-y-2 text-xs">
          <p className="flex items-center gap-2 text-slate-500">
            {toll_plazas.length} FASTag plaza{toll_plazas.length > 1 ? "s" : ""}
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
          Toll estimate
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

  if (id === "overhead" || id === "profit") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>
          {((Number(inputs[id === "overhead" ? "overhead_pct" : "profit_pct"])) * 100).toFixed(0)}%
          of {formatInr(Number(inputs.base_inr))} cost base = <strong>{formatInr(row.amount_inr)}</strong>
        </p>
        <p className="text-slate-400">
          {id === "overhead"
            ? "Business overhead (dispatch, admin, insurance administration)"
            : "Transporter margin"}
        </p>
      </div>
    );
  }

  if (id === "empty_return") {
    return (
      <div className="space-y-1 text-xs text-slate-600">
        <p>{(Number(inputs.empty_pct) * 100).toFixed(0)}% of {inputs.distance_km} km = <strong>{inputs.empty_km} km driven back empty</strong></p>
        <p>{inputs.empty_km} km × ₹{inputs.variable_per_km}/km variable cost = <strong>{formatInr(row.amount_inr)}</strong></p>
        <p className="text-slate-400">Variable cost = fuel + maintenance + depreciation + overhead + toll + waiting</p>
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
              <Fragment key={row.id}>
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
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
