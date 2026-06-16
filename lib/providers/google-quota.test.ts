import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";

const TMP = join(process.cwd(), ".google-usage.test.json");
process.env.GOOGLE_USAGE_FILE = TMP;
process.env.GOOGLE_GEOCODE_MONTHLY_CAP = "3";

// Imported AFTER env is set so the module reads the test file path
const { canCallGoogle, recordGoogleCall, googleUsage } = await import("./google-quota");

describe("google-quota", () => {
  beforeEach(() => { try { rmSync(TMP); } catch {} });
  afterEach(() => { try { rmSync(TMP); } catch {} });

  it("allows calls under the cap and blocks at the cap", () => {
    expect(canCallGoogle("geocode")).toBe(true);
    recordGoogleCall("geocode");
    recordGoogleCall("geocode");
    expect(googleUsage("geocode").used).toBe(2);
    expect(canCallGoogle("geocode")).toBe(true); // 2 < 3
    recordGoogleCall("geocode");
    expect(canCallGoogle("geocode")).toBe(false); // 3 >= 3
  });

  it("tracks geocode and routes independently", () => {
    recordGoogleCall("geocode");
    expect(googleUsage("routes").used).toBe(0);
  });
});
