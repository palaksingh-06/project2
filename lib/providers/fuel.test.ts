import { describe, expect, it } from "vitest";
import {
  lookupDieselInMap,
  resolveStateKey,
} from "@/lib/providers/fuel";

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
