// Airtight, app-side monthly request cap for Google Maps APIs.
// Google does not stop charging when the free tier is exceeded, so the app must
// enforce the limit itself. Counts are persisted to a JSON file (reliable on a
// single always-on server) and reset automatically each calendar month.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

type Api = "geocode" | "routes";

interface Usage {
  month: string; // "YYYY-MM"
  geocode: number;
  routes: number;
}

const DEFAULT_CAP = 10000; // free-tier requests per API per month

// Overridable for tests
function usageFile(): string {
  return process.env.GOOGLE_USAGE_FILE || join(process.cwd(), ".google-usage.json");
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Reads current usage; resets to zero when the stored month is stale or the file
// is missing/corrupt.
function read(): Usage {
  try {
    const f = usageFile();
    if (existsSync(f)) {
      const data = JSON.parse(readFileSync(f, "utf-8")) as Usage;
      if (data.month === currentMonth()) return data;
    }
  } catch {
    /* fall through to a fresh month */
  }
  return { month: currentMonth(), geocode: 0, routes: 0 };
}

function write(u: Usage): void {
  try {
    writeFileSync(usageFile(), JSON.stringify(u), "utf-8");
  } catch {
    /* best-effort; a write failure must not crash a calculation */
  }
}

function capFor(api: Api): number {
  const env =
    api === "geocode"
      ? process.env.GOOGLE_GEOCODE_MONTHLY_CAP
      : process.env.GOOGLE_ROUTES_MONTHLY_CAP;
  const n = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_CAP;
}

// True only while this month's usage is strictly under the cap.
export function canCallGoogle(api: Api): boolean {
  return read()[api] < capFor(api);
}

// Increment after every dispatched Google request (all are billable).
export function recordGoogleCall(api: Api): void {
  const u = read();
  u[api] += 1;
  write(u);
}

export function googleUsage(api: Api): { used: number; cap: number } {
  return { used: read()[api], cap: capFor(api) };
}
