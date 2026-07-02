import { describe, expect, it } from "vitest";
import { calculateZBC, tripDays } from "@/lib/zbc/calculate";
import { validateContributions } from "@/lib/zbc/validate";
import { getTruckProfile, getZbcGuidelines } from "@/lib/config";

const guidelines = getZbcGuidelines();

describe("tripDays", () => {
  it("returns at least 1 day", () => {
    expect(tripDays(100, 45)).toBe(1);
    expect(tripDays(2000, 45)).toBeGreaterThan(1);
  });
});

describe("calculateZBC Delhi-Mumbai 16T", () => {
  const profile = getTruckProfile("16T_6W")!;
  const D = 1400;
  const days = tripDays(D, 45);

  const result = calculateZBC({
    truckId: "16T_6W",
    profile,
    payloadTons: 16,
    distance_km: D,
    days,
    diesel_price_inr: 93,
    toll: {
      total_inr: 7200,
      plaza_count: 24,
      provenance: {
        kind: "config",
        label: "NH-48 corridor benchmark",
        detail: "config/fallback-rates.json",
      },
    },
    avg_speed_kmh: 45,
    trip_type: "one-way",
    guidelines,
    terrain: "Plain",
  });

  it("has 15 cost lines for a one-way trip with defaults (no helper/optional add-ons)", () => {
    // fuel, driver, maintenance, tyres, depreciation_usage, depreciation_aging,
    // insurance, road_tax, fitness, interest, toll, loading, empty_return,
    // overhead, profit = 15. Helper and optional add-ons are omitted (off by
    // default, no override/profile value supplied).
    expect(result.lines).toHaveLength(15);
  });

  it("does not include a helper line when helper_per_day is unset", () => {
    expect(result.lines.find((l) => l.id === "helper")).toBeUndefined();
  });

  it("total equals subtotal plus overhead plus profit", () => {
    const overhead = result.lines.find((l) => l.id === "overhead")!;
    const profit = result.lines.find((l) => l.id === "profit")!;
    expect(result.total_inr).toBe(
      result.subtotal_inr + overhead.amount_inr + profit.amount_inr
    );
  });

  it("fuel is a large contributor, larger than overhead alone", () => {
    const fuel = result.lines.find((l) => l.id === "fuel")!;
    const overhead = result.lines.find((l) => l.id === "overhead")!;
    expect(fuel.amount_inr).toBeGreaterThan(0);
    expect(fuel.amount_inr).toBeGreaterThan(overhead.amount_inr);
  });

  it("profit is 10% of the cost base and overhead is 7% of the same base", () => {
    const overhead = result.lines.find((l) => l.id === "overhead")!;
    const profit = result.lines.find((l) => l.id === "profit")!;
    expect(Number(overhead.inputs.overhead_pct)).toBeCloseTo(0.07);
    expect(Number(profit.inputs.profit_pct)).toBeCloseTo(0.10);
    expect(Number(overhead.inputs.base_inr)).toBe(Number(profit.inputs.base_inr));
  });

  it("validateContributions returns a status per head", () => {
    const checks = validateContributions(result);
    expect(checks).toHaveLength(15);
    checks.forEach((c) => {
      expect(["ok", "low", "high"]).toContain(c.status);
      expect(c.pct).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("calculateZBC depreciation split", () => {
  const profile = getTruckProfile("9T_4W")!;
  const base = {
    truckId: "9T_4W",
    profile,
    payloadTons: 9,
    distance_km: 500,
    days: 2,
    diesel_price_inr: 90,
    toll: {
      total_inr: 1000,
      plaza_count: 5,
      provenance: { kind: "estimate" as const, label: "₹/km × distance" },
    },
    avg_speed_kmh: 45,
    trip_type: "one-way",
    guidelines,
  };

  it("usage depreciation is higher on Hill terrain than Plain terrain", () => {
    const plain = calculateZBC({ ...base, terrain: "Plain" });
    const hill = calculateZBC({ ...base, terrain: "Hill" });
    const plainDep = plain.lines.find((l) => l.id === "depreciation_usage")!.amount_inr;
    const hillDep = hill.lines.find((l) => l.id === "depreciation_usage")!.amount_inr;
    expect(hillDep).toBeGreaterThan(plainDep);
  });

  it("aging depreciation is unaffected by terrain", () => {
    const plain = calculateZBC({ ...base, terrain: "Plain" });
    const hill = calculateZBC({ ...base, terrain: "Hill" });
    const plainAging = plain.lines.find((l) => l.id === "depreciation_aging")!.amount_inr;
    const hillAging = hill.lines.find((l) => l.id === "depreciation_aging")!.amount_inr;
    expect(plainAging).toBe(hillAging);
  });
});

describe("calculateZBC with overrides", () => {
  const profile = getTruckProfile("9T_4W")!;

  it("applies overhead_pct and profit_pct overrides", () => {
    const base = calculateZBC({
      truckId: "9T_4W",
      profile,
      payloadTons: 9,
      distance_km: 500,
      days: 2,
      diesel_price_inr: 90,
      toll: {
        total_inr: 1000,
        plaza_count: 5,
        provenance: { kind: "estimate", label: "₹/km × distance" },
      },
      avg_speed_kmh: 45,
      trip_type: "one-way",
      guidelines,
    });
    const higherMargin = calculateZBC({
      truckId: "9T_4W",
      profile,
      payloadTons: 9,
      distance_km: 500,
      days: 2,
      diesel_price_inr: 90,
      toll: {
        total_inr: 1000,
        plaza_count: 5,
        provenance: { kind: "estimate", label: "₹/km × distance" },
      },
      overrides: { overhead_pct: 0.15, profit_pct: 0.2 },
      avg_speed_kmh: 45,
      trip_type: "one-way",
      guidelines,
    });
    expect(higherMargin.total_inr).toBeGreaterThan(base.total_inr);
  });

  it("adds a helper line only when helper_per_day override is supplied", () => {
    const withHelper = calculateZBC({
      truckId: "9T_4W",
      profile,
      payloadTons: 9,
      distance_km: 500,
      days: 2,
      diesel_price_inr: 90,
      toll: {
        total_inr: 1000,
        plaza_count: 5,
        provenance: { kind: "estimate", label: "₹/km × distance" },
      },
      overrides: { helper_per_day: 400 },
      avg_speed_kmh: 45,
      trip_type: "one-way",
      guidelines,
    });
    const helper = withHelper.lines.find((l) => l.id === "helper");
    expect(helper).toBeDefined();
    expect(helper!.amount_inr).toBe(800); // 400/day * 2 days
  });
});
