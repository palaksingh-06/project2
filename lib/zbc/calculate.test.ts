import { describe, expect, it } from "vitest";
import { calculateZBC, tripDays } from "@/lib/zbc/calculate";
import { validateContributions } from "@/lib/zbc/validate";
import { getTruckProfile } from "@/lib/config";

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
  });

  it("has 9 cost lines", () => {
    expect(result.lines).toHaveLength(9);
  });

  it("total equals subtotal plus risk", () => {
    const risk = result.lines.find((l) => l.id === "risk")!;
    expect(result.total_inr).toBe(result.subtotal_inr + risk.amount_inr);
  });

  it("fuel is largest contributor", () => {
    const fuel = result.lines.find((l) => l.id === "fuel")!;
    expect(fuel.amount_inr).toBeGreaterThan(0);
    expect(fuel.amount_inr).toBeGreaterThan(
      result.lines.find((l) => l.id === "overhead")!.amount_inr
    );
  });

  it("validateContributions returns status per head", () => {
    const checks = validateContributions(result);
    expect(checks).toHaveLength(9);
    checks.forEach((c) => {
      expect(["ok", "low", "high"]).toContain(c.status);
      expect(c.pct).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("calculateZBC with overrides", () => {
  const profile = getTruckProfile("9T_4W")!;

  it("applies risk override", () => {
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
    });
    const highRisk = calculateZBC({
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
      overrides: { risk_pct: 0.05 },
      avg_speed_kmh: 45,
      trip_type: "one-way",
    });
    expect(highRisk.total_inr).toBeGreaterThan(base.total_inr);
  });
});
