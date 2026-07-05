import React from "react";

export type CostSource = "real" | "proxy" | "estimate";

const STYLES: Record<CostSource, string> = {
  real: "bg-emerald-100 text-emerald-800",
  proxy: "bg-amber-100 text-amber-800",
  estimate: "bg-slate-200 text-slate-700",
};

const LABELS: Record<CostSource, string> = {
  real: "Real",
  proxy: "Proxy",
  estimate: "Estimate",
};

export function CostSourceBadge({ source }: { source: CostSource }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STYLES[source]}`}
      title={
        source === "real"
          ? "Sourced from a real published spec/price"
          : source === "proxy"
            ? "Derived from a close sibling model's real figure"
            : "No model-specific figure found; category-level estimate"
      }
    >
      {LABELS[source]}
    </span>
  );
}
