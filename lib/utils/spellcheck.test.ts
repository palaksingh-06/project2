import { describe, expect, it } from "vitest";
import { suggestCities } from "@/lib/utils/spellcheck";

describe("suggestCities", () => {
  const cities = [
    { name: "Delhi" },
    { name: "Mumbai" },
    { name: "Bangalore" },
  ];

  it("suggests close matches for typos", () => {
    const s = suggestCities("Delli", cities);
    expect(s).toContain("Delhi");
  });

  it("returns empty for unrelated query", () => {
    const s = suggestCities("xyzabc", cities);
    expect(s.length).toBe(0);
  });
});
