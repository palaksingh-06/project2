import type { ContributionStatus } from "@/lib/zbc/types";

const styles: Record<ContributionStatus, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  low: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const labels: Record<ContributionStatus, string> = {
  ok: "OK",
  low: "Low",
  high: "High",
};

export function ContributionBadge({
  status,
  pct,
  range,
}: {
  status: ContributionStatus;
  pct: number;
  range: { min: number; max: number };
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
      title={`Expected ${range.min}–${range.max}%`}
    >
      {labels[status]} · {pct}% (band {range.min}–{range.max}%)
    </span>
  );
}
