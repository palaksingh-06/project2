import { describe, it, expect, vi, afterEach } from "vitest";

describe("getTollEstimate", () => {
  // Restore all spies and env stubs after each test to prevent cross-test pollution
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns estimate provenance when TOLLGURU_ENABLED is not true", async () => {
    // TOLLGURU_ENABLED is false so the ₹/km estimate fallback is used
    vi.stubEnv("TOLLGURU_ENABLED", "false");
    vi.stubEnv("TOLLGURU_API_KEY", "");

    const { getTollEstimate } = await import("@/lib/providers/tolls");
    const result = await getTollEstimate(
      "Delhi",
      "Panipat",
      "twoAxle",
      100,
      { lat: 28.7041, lng: 77.1025 },
      { lat: 29.3909, lng: 76.9635 }
    );

    expect(result.provenance.kind).toBe("estimate");
    expect(result.provenance.label).toBe("₹/km × distance");
    expect(result.total_inr).toBeGreaterThan(0);
  });

  it("returns estimate when no coords provided (TollGuru cannot run)", async () => {
    // TollGuru requires coords; without them it always falls to estimate
    vi.stubEnv("TOLLGURU_ENABLED", "true");
    vi.stubEnv("TOLLGURU_API_KEY", "test-key");

    const { getTollEstimate } = await import("@/lib/providers/tolls");
    // No originCoords / destCoords passed
    const result = await getTollEstimate("Delhi", "Panipat", "twoAxle", 100);

    expect(result.provenance.kind).toBe("estimate");
  });

  it("returns api provenance when TOLLGURU_ENABLED=true and fetch succeeds", async () => {
    vi.stubEnv("TOLLGURU_ENABLED", "true");
    vi.stubEnv("TOLLGURU_API_KEY", "test-key");

    // TollGuru v2 returns { routes: [...] }; route.costs.tag holds the FASTag amount
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          routes: [
            {
              summary: { hasTolls: true },
              costs: { tag: 250 },
              tolls: [
                { name: "Kundli Toll", tagCost: 125 },
                { name: "Panipat Toll", tagCost: 125 },
              ],
            },
          ],
        }),
    } as Response);

    const { getTollEstimate } = await import("@/lib/providers/tolls");
    const result = await getTollEstimate(
      "Delhi",
      "Panipat",
      "twoAxle",
      100,
      { lat: 28.7041, lng: 77.1025 },
      { lat: 29.3909, lng: 76.9635 }
    );

    expect(result.provenance.kind).toBe("api");
    expect(result.provenance.label).toBe("TollGuru");
    expect(result.total_inr).toBe(250);
  });

  it("falls back to estimate when TollGuru fetch returns non-ok response", async () => {
    vi.stubEnv("TOLLGURU_ENABLED", "true");
    vi.stubEnv("TOLLGURU_API_KEY", "test-key");

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as Response);

    const { getTollEstimate } = await import("@/lib/providers/tolls");
    const result = await getTollEstimate(
      "Delhi",
      "Panipat",
      "twoAxle",
      100,
      { lat: 28.7041, lng: 77.1025 },
      { lat: 29.3909, lng: 76.9635 }
    );

    expect(result.provenance.kind).toBe("estimate");
  });
});
