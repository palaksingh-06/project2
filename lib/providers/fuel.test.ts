import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDieselPrice,
  clearFuelPriceCache,
  lookupDieselInMap,
  resolveStateKey,
} from "@/lib/providers/fuel";

// ── Pure helper unit tests ────────────────────────────────────────────────────
describe("fuel state matching", () => {
  const sampleMap = new Map([
    ["gujarat", { name: "Gujarat", diesel: 98.08 }],
    ["delhi", { name: "Delhi", diesel: 95.2 }],
    ["chhatisgarh", { name: "Chhatisgarh", diesel: 101.32 }],
  ]);

  it("resolves Chhattisgarh alias", () => {
    expect(resolveStateKey("Chhattisgarh")).toBe("chhatisgarh");
  });

  it("finds Gujarat diesel", () => {
    const m = lookupDieselInMap("Gujarat", sampleMap);
    expect(m?.diesel).toBe(98.08);
  });

  it("finds Delhi case-insensitively", () => {
    const m = lookupDieselInMap("delhi", sampleMap);
    expect(m?.name).toBe("Delhi");
  });

  it("returns null for unknown state", () => {
    expect(lookupDieselInMap("Atlantis", sampleMap)).toBeNull();
  });
});

// ── getDieselPrice integration tests (with fetch mocking) ────────────────────
describe("getDieselPrice", () => {
  // Clear the module-level price cache and restore fetch mocks between tests
  beforeEach(() => {
    clearFuelPriceCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearFuelPriceCache();
    vi.restoreAllMocks();
  });

  it("returns api provenance when Core API returns valid diesel price", async () => {
    // Mock the Core fuel price API returning a valid Haryana diesel price
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        fetchedAt: "2024-01-15",
        source: "energy.thecore.in",
        states: {
          haryana: { name: "Haryana", diesel: 96 },
        },
      }),
    } as Response);

    const result = await getDieselPrice("Haryana");

    expect(result.provenance.kind).toBe("api");
    expect(result.price_inr).toBe(96);
    expect(result.state).toBe("Haryana");
  });

  it("returns config provenance when Core API fetch throws a network error", async () => {
    // Network failure → module falls back to config/fallback-rates.json
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const result = await getDieselPrice("Haryana");

    expect(result.provenance.kind).toBe("config");
    expect(result.price_inr).toBeGreaterThan(0);
  });

  it("returns config provenance when Core API returns non-ok HTTP status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    const result = await getDieselPrice("Maharashtra");

    expect(result.provenance.kind).toBe("config");
    expect(result.price_inr).toBeGreaterThan(0);
  });

  it("returns config provenance when requested state is absent from API response", async () => {
    // API succeeds but the state we asked for is not in the payload
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        states: {
          kerala: { name: "Kerala", diesel: 95 },
        },
      }),
    } as Response);

    const result = await getDieselPrice("Haryana");

    expect(result.provenance.kind).toBe("config");
  });
});
