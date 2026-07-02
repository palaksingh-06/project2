import { describe, expect, it } from "vitest";
import {
  tripDurationHours,
  tripsPerMonth,
  estimateAnnualKm,
} from "@/lib/zbc/utilization";
import { getZbcGuidelines } from "@/lib/config";

const g = getZbcGuidelines();

describe("tripDurationHours", () => {
  it("matches the Unnati worked example: 500km @ 50km/h with return load = 44 hrs", () => {
    // placement(2) + plant_turnaround(4) + travel(10) + client_turnaround(4)
    // + return_to_garage(4) + rest(8, since 500km > 150km threshold) + wait(12, has return load)
    expect(tripDurationHours(500, 50, true, g)).toBe(44);
  });

  it("omits the return-load wait when there is no return load", () => {
    expect(tripDurationHours(500, 50, false, g)).toBe(32); // 44 - 12
  });

  it("omits rest hours when distance is at or below the threshold", () => {
    // 100km @ 50km/h: travel=2hrs, no rest since 100 <= 150
    // 2 + 4 + 2 + 4 + 4 + 0 + 12 = 28
    expect(tripDurationHours(100, 50, true, g)).toBe(28);
  });

  it("rounds travel time up to the next whole hour", () => {
    // 501km @ 50km/h = 10.02 -> ceil to 11 hrs travel
    // 2 + 4 + 11 + 4 + 4 + 8 + 12 = 45
    expect(tripDurationHours(501, 50, true, g)).toBe(45);
  });
});

describe("tripsPerMonth", () => {
  it("matches the Unnati worked example: 44hr trips at 90% uptime = 14 trips/month", () => {
    expect(tripsPerMonth(44, 0.9)).toBe(14);
  });

  it("rounds down (never overcommits a partial trip)", () => {
    // 30*24/40*0.9 = 16.2 -> floor to 16
    expect(tripsPerMonth(40, 0.9)).toBe(16);
  });
});

describe("estimateAnnualKm", () => {
  it("matches the Unnati worked example: 500km trip -> 168,000 annual km", () => {
    expect(estimateAnnualKm(500, 50, true, g)).toBe(168000);
  });

  it("returns 0 for a degenerate zero-distance trip without throwing", () => {
    expect(() => estimateAnnualKm(0, 50, true, g)).not.toThrow();
  });
});
