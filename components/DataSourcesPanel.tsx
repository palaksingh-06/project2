"use client";

import type { Provenance } from "@/lib/zbc/provenance";
import {
  PROVENANCE_LEGEND,
  provenanceBadgeClass,
} from "@/lib/zbc/provenance";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import type { CostHeadId } from "@/lib/zbc/types";

export interface InputProvenance {
  geocode_origin: Provenance;
  geocode_destination: Provenance;
  distance: Provenance;
  fuel: Provenance;
  toll: Provenance;
}

export function DataSourcesPanel({
  inputs,
  costHeads,
  tollPlazas,
  highway,
}: {
  inputs: InputProvenance;
  costHeads: Record<string, Provenance>;
  tollPlazas?: number;
  highway?: string;
}) {
  const rows: { group: string; name: string; p: Provenance; note?: string }[] =
    [
      {
        group: "Route inputs",
        name: "Origin coordinates",
        p: inputs.geocode_origin,
      },
      {
        group: "Route inputs",
        name: "Destination coordinates",
        p: inputs.geocode_destination,
      },
      {
        group: "Route inputs",
        name: "Road distance",
        p: inputs.distance,
      },
      {
        group: "Route inputs",
        name: "Diesel price",
        p: inputs.fuel,
      },
      {
        group: "Route inputs",
        name: "Toll total",
        p: inputs.toll,
        note:
          tollPlazas && highway
            ? `${tollPlazas} plazas · ${highway}`
            : tollPlazas
              ? `${tollPlazas} plazas (approx.)`
              : undefined,
      },
    ];

  const headOrder: CostHeadId[] = [
    "fuel",
    "driver",
    "helper",
    "maintenance",
    "tyres",
    "depreciation_usage",
    "depreciation_aging",
    "insurance",
    "road_tax",
    "fitness",
    "interest",
    "toll",
    "loading",
    "empty_return",
    "overhead",
    "profit",
  ];

  const headLabels: Record<CostHeadId, string> = {
    fuel: "Fuel",
    driver: "Driver salary",
    helper: "Helper / cleaner salary",
    maintenance: "Maintenance",
    tyres: "Tyres",
    depreciation_usage: "Depreciation (usage)",
    depreciation_aging: "Depreciation (aging)",
    insurance: "Insurance",
    road_tax: "Road tax / permit",
    fitness: "Fitness certificate",
    interest: "Interest",
    gps: "GPS charges",
    fastag_fee: "FASTag service fee",
    rto_misc: "RTO / miscellaneous",
    tarpaulin: "Tarpaulin",
    other_fixed: "Other fixed costs",
    toll: "Toll & permits",
    loading: "Loading",
    empty_return: "Empty return",
    overhead: "Overhead",
    profit: "Transporter profit",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h3 className="font-semibold text-slate-900">Data provenance</h3>
      <p className="mt-1 text-xs text-slate-600">
        What is fetched from APIs vs assumed in config files.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {PROVENANCE_LEGEND.map((l) => (
          <span key={l.kind} className="text-slate-600">
            <span
              className={`mr-1 inline-block rounded px-1 py-0.5 font-medium ${provenanceBadgeClass(l.kind)}`}
            >
              {l.title}
            </span>
            {l.description}
          </span>
        ))}
      </div>

      <table className="mt-4 w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-left text-slate-500">
            <th className="pb-2 pr-2">Item</th>
            <th className="pb-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-slate-50">
              <td className="py-2 pr-2 align-top text-slate-700">
                {r.name}
                {r.note && (
                  <div className="text-slate-400">{r.note}</div>
                )}
              </td>
              <td className="py-2 align-top">
                <ProvenanceBadge p={r.p} showDetail />
              </td>
            </tr>
          ))}
          <tr>
            <td
              colSpan={2}
              className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              Cost heads (rates)
            </td>
          </tr>
          {headOrder.map((id) => {
            const p = costHeads[id];
            if (!p) return null;
            return (
              <tr key={id} className="border-b border-slate-50">
                <td className="py-2 pr-2 text-slate-700">{headLabels[id]}</td>
                <td className="py-2">
                  <ProvenanceBadge p={p} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
