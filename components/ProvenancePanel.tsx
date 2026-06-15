"use client";

import type { Provenance } from "@/lib/zbc/provenance";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";

// Minimal provenance shape — matches Provenance but all fields optional except kind+label
interface ProvenanceInfo {
  kind: string;
  label: string;
  detail?: string;
  updated_at?: string;
}

interface ProvenanceData {
  meta: {
    inputs?: {
      geocode_origin?: ProvenanceInfo;
      geocode_origin_name?: ProvenanceInfo;
      geocode_destination?: ProvenanceInfo;
      geocode_destination_name?: ProvenanceInfo;
      distance?: ProvenanceInfo;
      fuel?: ProvenanceInfo;
      toll?: ProvenanceInfo;
    };
    cost_heads?: Record<string, ProvenanceInfo>;
    truck?: {
      truck_id: string;
      truck_label: string;
      model_id?: string;
      model_label?: string;
      mileage_used: number;
      provenance: ProvenanceInfo;
    };
  };
}

// Cost-head display order and labels (fuel is intentionally skipped — it comes from inputs)
const COST_HEAD_ORDER = [
  "driver",
  "vehicle",
  "maintenance",
  "loading",
  "idle",
  "overhead",
  "risk",
  "empty_return",
] as const;

const COST_HEAD_LABELS: Record<string, string> = {
  driver: "Driver & crew",
  vehicle: "Vehicle",
  maintenance: "Maintenance",
  loading: "Loading",
  idle: "Idle",
  overhead: "Overhead",
  risk: "Risk",
  empty_return: "Empty return",
};

// Shared section header style
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 first:pt-0">
      {title}
    </div>
  );
}

// A single label + badge row
function ProvenanceRow({ name, p }: { name: string; p: ProvenanceInfo }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 py-2">
      <span className="text-xs text-slate-700">{name}</span>
      {/* Cast to Provenance — shape is identical */}
      <ProvenanceBadge p={p as Provenance} showDetail />
    </div>
  );
}

export function ProvenancePanel({ result }: { result: ProvenanceData }) {
  const { meta } = result;

  return (
    <div className="text-sm">
      {/* Section 1: Truck mapping */}
      {meta.truck && (
        <>
          <SectionHeader title="Truck mapping" />
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            <div>
              <span className="text-slate-400">Resolved: </span>
              {meta.truck.truck_label}
              {meta.truck.model_label && (
                <span className="ml-1 text-slate-500">· {meta.truck.model_label}</span>
              )}
            </div>
            <div>
              <span className="text-slate-400">Mileage used: </span>
              {meta.truck.mileage_used} km/l
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-slate-400">How resolved:</span>
              <ProvenanceBadge p={meta.truck.provenance as Provenance} />
            </div>
          </div>
        </>
      )}

      {/* Section 2: Route inputs */}
      <SectionHeader title="Route inputs" />
      <div>
        {meta.inputs?.geocode_origin && (
          <ProvenanceRow name="Origin coordinates" p={meta.inputs.geocode_origin} />
        )}
        {meta.inputs?.geocode_origin_name && (
          <ProvenanceRow name="Origin name" p={meta.inputs.geocode_origin_name} />
        )}
        {meta.inputs?.geocode_destination && (
          <ProvenanceRow name="Destination coordinates" p={meta.inputs.geocode_destination} />
        )}
        {meta.inputs?.geocode_destination_name && (
          <ProvenanceRow name="Destination name" p={meta.inputs.geocode_destination_name} />
        )}
        {meta.inputs?.distance && (
          <ProvenanceRow name="Road distance" p={meta.inputs.distance} />
        )}
        {meta.inputs?.toll && (
          <ProvenanceRow name="Toll" p={meta.inputs.toll} />
        )}
        {meta.inputs?.fuel && (
          <ProvenanceRow name="Diesel price" p={meta.inputs.fuel} />
        )}
      </div>

      {/* Section 3: Cost-head rates */}
      {meta.cost_heads && (
        <>
          <SectionHeader title="Cost-head rates" />
          <div>
            {COST_HEAD_ORDER.map((id) => {
              const p = meta.cost_heads?.[id];
              if (!p) return null;
              return (
                <ProvenanceRow key={id} name={COST_HEAD_LABELS[id] ?? id} p={p} />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
