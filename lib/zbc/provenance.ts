/** How a value was obtained — never use vague "live" for config data */

export type ProvenanceKind = "api" | "config" | "estimate" | "input";

export interface Provenance {
  kind: ProvenanceKind;
  /** Short label shown in UI, e.g. "OpenRouteService" */
  label: string;
  /** Extra context, e.g. file name or formula */
  detail?: string;
  /** ISO timestamp when external data was published (API feeds only) */
  updated_at?: string;
}

export const PROVENANCE_LEGEND: {
  kind: ProvenanceKind;
  title: string;
  description: string;
}[] = [
  {
    kind: "api",
    title: "API",
    description: "Fetched from an external service at calculation time",
  },
  {
    kind: "config",
    title: "Config",
    description: "Static values in repo JSON — update files to change",
  },
  {
    kind: "estimate",
    title: "Estimate",
    description: "Formula or benchmark when no API/config corridor exists",
  },
  {
    kind: "input",
    title: "Provided",
    description: "Supplied in the request / CSV — not fetched or assumed",
  },
];

export function provenanceBadgeClass(kind: ProvenanceKind): string {
  switch (kind) {
    case "api":
      return "bg-emerald-100 text-emerald-800";
    case "config":
      return "bg-slate-200 text-slate-800";
    case "estimate":
      return "bg-amber-100 text-amber-800";
    case "input":
      return "bg-sky-100 text-sky-800";
  }
}

export function provenanceKindTitle(kind: ProvenanceKind): string {
  return PROVENANCE_LEGEND.find((l) => l.kind === kind)?.title ?? kind;
}
