import { getTruckRatesConfig } from "@/lib/config";
import type {
  CalculateResult,
  ContributionCheck,
  CostHeadId,
} from "@/lib/zbc/types";

const HEAD_LABELS: Record<CostHeadId, string> = {
  fuel: "Fuel Cost",
  driver: "Driver & Crew",
  vehicle: "Vehicle Cost",
  toll: "Toll & Permits",
  maintenance: "Maintenance & Tyres",
  loading: "Loading & Unloading",
  overhead: "Overheads",
  risk: "Risk & Variability",
  empty_return: "Empty Return (Backhaul)",
};

export function validateContributions(
  result: CalculateResult
): ContributionCheck[] {
  const ranges = getTruckRatesConfig().contribution_ranges;
  const total = result.total_inr;

  return result.lines.map((line) => {
    const pct = total > 0 ? (line.amount_inr / total) * 100 : 0;
    const range = ranges[line.id] ?? { min: 0, max: 100 };
    let status: "ok" | "low" | "high" = "ok";
    if (pct < range.min) status = "low";
    else if (pct > range.max) status = "high";

    return {
      id: line.id,
      name: HEAD_LABELS[line.id] ?? line.name,
      pct: Math.round(pct * 10) / 10,
      range,
      status,
    };
  });
}
