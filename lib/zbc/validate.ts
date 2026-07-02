import { getTruckRatesConfig } from "@/lib/config";
import type {
  CalculateResult,
  ContributionCheck,
  CostHeadId,
} from "@/lib/zbc/types";

const HEAD_LABELS: Record<CostHeadId, string> = {
  fuel: "Fuel Cost",
  driver: "Driver Salary",
  helper: "Helper / Cleaner Salary",
  maintenance: "Maintenance",
  tyres: "Tyres",
  depreciation_usage: "Depreciation (Usage)",
  depreciation_aging: "Depreciation (Aging)",
  insurance: "Insurance",
  road_tax: "Road Tax / Permit",
  fitness: "Fitness Certificate",
  interest: "Interest (Loan Carrying Cost)",
  gps: "GPS Charges",
  fastag_fee: "FASTag Service Fee",
  rto_misc: "RTO / Miscellaneous",
  tarpaulin: "Tarpaulin",
  other_fixed: "Other Fixed Costs",
  toll: "Toll & Permits",
  loading: "Loading & Unloading",
  empty_return: "Empty Return (Backhaul)",
  overhead: "Overhead",
  profit: "Transporter Profit",
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
