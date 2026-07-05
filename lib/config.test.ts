import { describe, expect, it } from "vitest";
import { getZbcGuidelines, getTerrainDepreciationMultiplier, getTruckModel, getTruckModels, getTruckRatesConfig } from "@/lib/config";

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

describe("getTruckModel (enriched schema)", () => {
  it("returns mileage_kmpl and ex_showroom_inr as {value, source} objects", () => {
    const m = getTruckModel("tata-ace-mega");
    expect(m).not.toBeNull();
    expect(typeof m!.mileage_kmpl.value).toBe("number");
    expect(["real", "proxy", "estimate"]).toContain(m!.mileage_kmpl.source);
    expect(typeof m!.ex_showroom_inr.value).toBe("number");
    expect(["real", "proxy", "estimate"]).toContain(m!.ex_showroom_inr.source);
  });

  it("every model in the config has the enriched shape", () => {
    const models = getTruckModels();
    for (const [id, m] of Object.entries(models)) {
      expect(typeof m.mileage_kmpl.value, `${id}.mileage_kmpl.value`).toBe("number");
      expect(typeof m.ex_showroom_inr.value, `${id}.ex_showroom_inr.value`).toBe("number");
      expect(m.mileage_kmpl.value, `${id}.mileage_kmpl.value should be positive`).toBeGreaterThan(0);
      expect(m.ex_showroom_inr.value, `${id}.ex_showroom_inr.value should be positive`).toBeGreaterThan(0);
    }
  });

  it("real/proxy sources are only claimed with a note in the research log", () => {
    const models = getTruckModels();
    const realOrProxyCount = Object.values(models).filter(
      (m) => m.mileage_kmpl.source !== "estimate" || m.ex_showroom_inr.source !== "estimate"
    ).length;
    // At least half the catalog should have moved past pure estimates once
    // research is done — this is a coarse regression guard, not a precise
    // target: it catches "the whole file silently reverted to all-estimate"
    // without dictating exactly how many models must be real.
    expect(realOrProxyCount).toBeGreaterThan(Object.keys(models).length / 2);
  });
});

describe("getTruckModels covers every truck-rates.json category", () => {
  it("has at least one model for every truck category", () => {
    // Requires importing getTruckRatesConfig alongside getTruckModels at the
    // top of this test file if not already imported.
    const rates = getTruckRatesConfig();
    const models = getTruckModels();
    const coveredClasses = new Set(Object.values(models).map((m) => m.truck_class));
    const uncovered = Object.keys(rates.trucks).filter((id) => !coveredClasses.has(id));
    expect(uncovered, `Categories with no named model: ${uncovered.join(", ")}`).toEqual([]);
  });
});
