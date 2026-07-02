import type { ZbcGuidelines } from "@/lib/config";

// Estimates how long one round-trip cycle takes, in hours. This mirrors the
// Unnati Excel "Master Sheet" utilization engine (rows 186-202): fixed
// handling times at each stage, plus travel time, plus rest breaks required
// by hours-of-service rules, plus (if applicable) time spent waiting to be
// loaded with a return cargo before heading back.
//
// distance_km is treated as one-way distance, matching Unnati's convention.
export function tripDurationHours(
  distance_km: number,
  avg_speed_kmh: number,
  hasReturnLoad: boolean,
  guidelines: ZbcGuidelines
): number {
  const travel_hrs = Math.ceil(distance_km / avg_speed_kmh);
  const rest_hrs = distance_km > guidelines.rest_threshold_km ? guidelines.rest_hrs : 0;
  const wait_hrs = hasReturnLoad ? guidelines.return_load_wait_hrs : 0;

  return (
    guidelines.placement_hrs +
    guidelines.plant_turnaround_hrs +
    travel_hrs +
    guidelines.client_turnaround_hrs +
    guidelines.return_to_garage_hrs +
    rest_hrs +
    wait_hrs
  );
}

// How many complete trip cycles fit into a 30-day month, discounted by the
// fleet's expected uptime (time lost to scheduled maintenance, driver rest
// days, breakdowns, etc. not already captured in trip_duration_hrs).
export function tripsPerMonth(trip_duration_hrs: number, uptime_pct: number): number {
  if (trip_duration_hrs <= 0) return 0;
  return Math.floor(((30 * 24) / trip_duration_hrs) * uptime_pct);
}

// Estimated annual km a truck covers running this kind of trip repeatedly.
// This is the denominator for every annual-km-allocated fixed cost line in
// lib/zbc/calculate.ts (depreciation-aging, insurance, road tax, fitness,
// interest, and the optional add-on fixed costs).
//
// ×2 accounts for the round trip (out + back); ×12 annualizes the monthly
// trip count.
export function estimateAnnualKm(
  distance_km: number,
  avg_speed_kmh: number,
  hasReturnLoad: boolean,
  guidelines: ZbcGuidelines
): number {
  const duration = tripDurationHours(distance_km, avg_speed_kmh, hasReturnLoad, guidelines);
  const trips = tripsPerMonth(duration, guidelines.uptime_pct);
  return trips * distance_km * 2 * 12;
}
