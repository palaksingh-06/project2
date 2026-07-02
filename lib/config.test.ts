import { describe, expect, it } from "vitest";
import { getZbcGuidelines, getTerrainDepreciationMultiplier } from "@/lib/config";

describe("getZbcGuidelines", () => {
  it("returns the utilization + overhead/profit constants", () => {
    const g = getZbcGuidelines();
    expect(g.uptime_pct).toBe(0.9);
    expect(g.overhead_pct).toBe(0.07);
    expect(g.profit_pct).toBe(0.10);
    expect(g.rest_threshold_km).toBe(150);
  });
});

describe("getTerrainDepreciationMultiplier", () => {
  it("returns 1.0 for Plain", () => {
    expect(getTerrainDepreciationMultiplier("Plain")).toBe(1.0);
  });

  it("returns 1.4 for Hill", () => {
    expect(getTerrainDepreciationMultiplier("Hill")).toBe(1.4);
  });

  it("defaults to 1.0 for unknown/undefined terrain", () => {
    expect(getTerrainDepreciationMultiplier(undefined)).toBe(1.0);
    expect(getTerrainDepreciationMultiplier("Coastal")).toBe(1.0);
  });
});
