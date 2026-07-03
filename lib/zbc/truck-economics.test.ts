import { describe, expect, it } from "vitest";
import { deriveDependentCosts } from "@/lib/zbc/truck-economics";

describe("deriveDependentCosts", () => {
  it("matches the Phase P0 migration script's own output for a known truck", () => {
    // 16T_6W's migrated ex_showroom_inr is 2,540,000 (see config/truck-rates.json)
    // and its migration-script-derived interest_per_year is 123,767 (verified in
    // the P0 whole-branch review). insurance_per_year for that truck is 63,500
    // (2,540,000 * 0.025). Both must reproduce exactly from the same inputs.
    const result = deriveDependentCosts(2540000);
    expect(result.insurance_per_year).toBe(63500);
    expect(result.interest_per_year).toBe(123767);
  });

  it("scales insurance linearly with price", () => {
    const cheap = deriveDependentCosts(1000000);
    const expensive = deriveDependentCosts(2000000);
    expect(expensive.insurance_per_year).toBe(cheap.insurance_per_year * 2);
  });

  it("returns whole-rupee integers", () => {
    const result = deriveDependentCosts(1234567);
    expect(Number.isInteger(result.insurance_per_year)).toBe(true);
    expect(Number.isInteger(result.interest_per_year)).toBe(true);
  });
});
