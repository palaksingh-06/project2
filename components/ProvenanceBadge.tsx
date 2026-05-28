import type { Provenance } from "@/lib/zbc/provenance";
import {
  provenanceBadgeClass,
  provenanceKindTitle,
} from "@/lib/zbc/provenance";

export function ProvenanceBadge({
  p,
  showDetail = false,
}: {
  p: Provenance;
  showDetail?: boolean;
}) {
  return (
    <span
      className={`inline-flex max-w-full flex-col gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ${provenanceBadgeClass(p.kind)}`}
      title={[p.label, p.detail, p.updated_at ? `Updated ${p.updated_at}` : ""]
        .filter(Boolean)
        .join(" · ")}
    >
      <span>
        {provenanceKindTitle(p.kind)} · {p.label}
      </span>
      {showDetail && p.detail && (
        <span className="font-normal opacity-90">{p.detail}</span>
      )}
      {p.updated_at && (
        <span className="font-normal opacity-80">
          Data as of {new Date(p.updated_at).toLocaleString("en-IN")}
        </span>
      )}
    </span>
  );
}
