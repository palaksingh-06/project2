import { describe, it, expect } from "vitest";
import { buildCostHeadProvenance } from "@/lib/zbc/cost-head-provenance";

describe("buildCostHeadProvenance", () => {
  // Representative provenance objects used across tests
  const tollEstimateProvenance = {
    kind: "estimate" as const,
    label: "₹/km × distance",
  };
  const tollApiProvenance = {
    kind: "api" as const,
    label: "TollGuru",
  };

  it("does not include fuel in the cost-head map", () => {
    // Fuel provenance is tracked separately on the calculation result, not here
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
    // When the user supplies driver_per_day the provenance flips to USER_OVERRIDE (kind: "input")
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { driver_per_day: 1200 },
    });
    expect(heads.driver.kind).toBe("input");
  });

  it("user override on vehicle_per_trip produces kind 'input' for vehicle head", () => {
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { vehicle_per_trip: 5000 },
    });
    expect(heads.vehicle.kind).toBe("input");
  });

  it("non-overridden heads retain config provenance", () => {
    // Only driver is overridden; vehicle, maintenance, etc. should stay 'config'
    const heads = buildCostHeadProvenance({
      toll: tollEstimateProvenance,
      overrides: { driver_per_day: 1200 },
    });
    expect(heads.vehicle.kind).toBe("config");
    expect(heads.maintenance.kind).toBe("config");
    expect(heads.loading.kind).toBe("config");
  });

  it("returns all expected cost heads", () => {
    const heads = buildCostHeadProvenance({ toll: tollEstimateProvenance });
    const keys = Object.keys(heads);
    // These are all the heads defined in cost-head-provenance.ts
    expect(keys).toContain("driver");
    expect(keys).toContain("vehicle");
    expect(keys).toContain("toll");
    expect(keys).toContain("maintenance");
    expect(keys).toContain("loading");
    expect(keys).toContain("idle");
    expect(keys).toContain("overhead");
    expect(keys).toContain("risk");
    expect(keys).toContain("empty_return");
  });
});
