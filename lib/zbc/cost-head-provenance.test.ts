import { describe, it, expect } from "vitest";
import { buildCostHeadProvenance } from "@/lib/zbc/cost-head-provenance";

describe("buildCostHeadProvenance", () => {
  const tollEstimateProvenance = {
    kind: "estimate" as const,
    label: "₹/km × distance",
  };
  const tollApiProvenance = {
    kind: "api" as const,
    label: "TollGuru",
  };

  it("does not include fuel in the cost-head map", () => {
    const heads = buildCostHeadProvenance({ toll: tollEstimateProvenance });
    expect("fuel" in heads).toBe(false);
  });

  it("toll head reflects the toll provenance kind (estimate)", () => {
    const heads = buildCostHeadProvenance({ toll: tollEstimateProvenance });
    expect(heads.toll.kind).toBe("estimate");
  });

  it("toll head reflects the toll provenance kind (api)", () => {
    const heads = buildCostHeadProvenance({ toll: tollApiProvenance });
    expect(heads.toll.kind).toBe("api");
  });

  it("user override on driver produces kind 'input'", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { driver_per_day: 1200 },
    });
    expect(heads.driver.kind).toBe("input");
  });

  it("user override on ex_showroom_inr produces kind 'input' for both depreciation heads", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { ex_showroom_inr: 500000 },
    });
    expect(heads.depreciation_aging.kind).toBe("input");
    expect(heads.depreciation_usage.kind).toBe("input");
  });

  it("user override on overhead_pct produces kind 'input' for overhead only", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { overhead_pct: 0.1 },
    });
    expect(heads.overhead.kind).toBe("input");
    expect(heads.profit.kind).toBe("config");
  });

  it("non-overridden heads retain config provenance", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { driver_per_day: 1200 },
    });
    expect(heads.depreciation_aging.kind).toBe("config");
    expect(heads.maintenance.kind).toBe("config");
    expect(heads.loading.kind).toBe("config");
  });

  it("returns all expected cost heads", () => {
    const heads = buildCostHeadProvenance({ toll: tollEstimateProvenance });
    const keys = Object.keys(heads);
    [
      "driver", "helper", "maintenance", "tyres", "depreciation_usage",
      "depreciation_aging", "insurance", "road_tax", "fitness", "interest",
      "gps", "fastag_fee", "rto_misc", "tarpaulin", "other_fixed", "toll",
      "loading", "empty_return", "overhead", "profit",
    ].forEach((k) => expect(keys).toContain(k));
  });
});
