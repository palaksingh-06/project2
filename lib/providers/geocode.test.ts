import { describe, it, expect, vi, afterEach } from "vitest";
import { geocodeFromCache } from "@/lib/providers/geocode";

describe("geocode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── geocodeFromCache (pure, no network) ────────────────────────────────────

  it("returns config provenance for a city in the cache", () => {
    // "Agra" is present in config/cities-cache.json
    const result = geocodeFromCache("Agra");

    expect(result).not.toBeNull();
    expect(result!.provenance.kind).toBe("config");
    expect(result!.provenance.label).toBe("City cache");
    expect(result!.lat).toBeGreaterThan(0);
  });

  it("returns null for a city not in the cache", () => {
    const result = geocodeFromCache("Atlantis");
    expect(result).toBeNull();
  });

  // ── geocode() with lat/lng input ───────────────────────────────────────────

  it("returns input provenance when given a lat,lng coordinate string", async () => {
    // Mock reverse-geocode Nominatim call that resolveLatLng makes internally
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { city: "New Delhi", state: "Delhi" },
      }),
    } as Response);

    const { geocode } = await import("@/lib/providers/geocode");
    const { result } = await geocode("28.6139, 77.2090");

    expect(result).not.toBeNull();
    expect(result!.provenance.kind).toBe("input");
    expect(result!.provenance.label).toBe("Provided coordinates");
    // Coordinates should be passed through unchanged
    expect(result!.lat).toBeCloseTo(28.6139);
    expect(result!.lng).toBeCloseTo(77.209);
  });

  // ── geocode() with Nominatim resolving a city name ─────────────────────────

  it("returns api provenance when Nominatim resolves a city name", async () => {
    // Mock Nominatim forward-geocode response
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          lat: "19.0760",
          lon: "72.8777",
          display_name: "Mumbai, Maharashtra, India",
          address: { city: "Mumbai", state: "Maharashtra" },
        },
      ],
    } as Response);

    const { geocode } = await import("@/lib/providers/geocode");
    const { result } = await geocode("Mumbai");

    expect(result).not.toBeNull();
    expect(result!.provenance.kind).toBe("api");
    expect(result!.provenance.label).toContain("Nominatim");
  });
});
