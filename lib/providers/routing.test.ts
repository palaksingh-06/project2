import { describe, it, expect, vi, afterEach } from "vitest";

describe("getRouteDistance", () => {
  // Restore all spies and env stubs after each test to prevent cross-test pollution
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns estimate provenance when no API keys are set", async () => {
    // Ensure no routing API keys are active so haversine fallback is used
    vi.stubEnv("OPENROUTESERVICE_API_KEY", "");
    vi.stubEnv("GOOGLE_ROUTES_ENABLED", "false");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");

    const { getRouteDistance } = await import("@/lib/providers/routing");
    const result = await getRouteDistance(
      { lat: 28.7041, lng: 77.1025 },
      { lat: 29.3909, lng: 76.9635 }
    );

    expect(result.provenance.kind).toBe("estimate");
    expect(result.provenance.label).toBe("Straight-line × road factor");
    expect(result.distance_km).toBeGreaterThan(0);
  });

  it("calls ORS when OPENROUTESERVICE_API_KEY is set and returns api provenance", async () => {
    vi.stubEnv("OPENROUTESERVICE_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_ROUTES_ENABLED", "false");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");

    // Mock fetch to return a valid ORS response with distance in meters
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        routes: [{ summary: { distance: 75000, duration: 3600 } }],
      }),
    } as Response);

    const { getRouteDistance } = await import("@/lib/providers/routing");
    const result = await getRouteDistance(
      { lat: 28.7041, lng: 77.1025 },
      { lat: 29.3909, lng: 76.9635 }
    );

    expect(result.provenance.kind).toBe("api");
    expect(result.provenance.label).toContain("OpenRouteService");
    // ORS returns distance in meters; divide by 1000 to get km
    expect(result.distance_km).toBeCloseTo(75);
  });

  it("falls back to estimate when ORS fetch fails", async () => {
    vi.stubEnv("OPENROUTESERVICE_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_ROUTES_ENABLED", "false");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");

    // ORS call throws a network error → should fall through to haversine
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const { getRouteDistance } = await import("@/lib/providers/routing");
    const result = await getRouteDistance(
      { lat: 28.7041, lng: 77.1025 },
      { lat: 29.3909, lng: 76.9635 }
    );

    expect(result.provenance.kind).toBe("estimate");
    expect(result.distance_km).toBeGreaterThan(0);
  });
});
