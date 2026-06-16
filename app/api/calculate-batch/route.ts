import { NextResponse } from "next/server";
import { z } from "zod";
import { runCalculation, CalculationError } from "@/lib/zbc/run-calculation";
import type { ValidatedRow } from "@/lib/csv/parse-batch";
import { MAX_BATCH_ROWS } from "@/lib/csv/parse-batch";
import { applyRouteAdjustments } from "@/lib/zbc/route-adjustments";
import type { AdjustableRow } from "@/lib/zbc/route-adjustments";

export const maxDuration = 60;

const rowSchema = z.object({
  rowNum: z.number().int(),
  truckId: z.string(),
  modelId: z.string().optional(),
  origin: z.string().min(1),
  destination: z.string().min(1),
  payloadTons: z.number().positive(),
  routeName: z.string().optional(),
  overrides: z
    .object({
      mileage_kmpl: z.number().positive().optional(),
      driver_per_day: z.number().nonnegative().optional(),
      bata_per_trip: z.number().nonnegative().optional(),
      night_halt_per_night: z.number().nonnegative().optional(),
      depreciation_per_km: z.number().nonnegative().optional(),
      vehicle_per_trip: z.number().nonnegative().optional(),
      state_permit: z.number().nonnegative().optional(),
      maintenance_per_km: z.number().nonnegative().optional(),
      loading_per_ton: z.number().nonnegative().optional(),
      idle_hours: z.number().nonnegative().optional(),
      idle_cost_per_hour: z.number().nonnegative().optional(),
      overhead_per_trip: z.number().nonnegative().optional(),
      risk_pct: z.number().min(0).max(1).optional(),
      empty_return_pct: z.number().min(0).max(1).optional(),
      empty_km: z.number().nonnegative().optional(),
    })
    .optional(),
  // Truck resolution provenance from CSV batch parsing
  truckResolution: z
    .object({
      truckId: z.string(),
      truckLabel: z.string(),
      modelId: z.string().optional(),
      modelLabel: z.string().optional(),
      tier: z.enum(["exact-model", "alias", "four-field", "filtered"]).optional(),
    })
    .optional(),
});

const batchSchema = z.object({
  rows: z.array(rowSchema).min(1).max(MAX_BATCH_ROWS),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = batchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { rows } = parsed.data as { rows: ValidatedRow[] };
    const results: Array<{ rowNum: number } & Record<string, unknown>> = [];
    const errors: Array<{ rowNum: number; error: string; suggestions?: string[] }> = [];

    for (const row of rows) {
      if (results.length + errors.length > 0) {
        await sleep(300);
      }
      try {
        const result = await runCalculation({
          truckId: row.truckId,
          modelId: row.modelId,
          origin: row.origin,
          destination: row.destination,
          payloadTons: row.payloadTons,
          overrides: row.overrides,
          truckResolution: row.truckResolution,
        });
        results.push({
          rowNum: row.rowNum,
          routeName: row.routeName,
          truckLabel: row.truckResolution?.truckLabel,
          ...result,
        });
      } catch (e) {
        if (e instanceof CalculationError) {
          errors.push({ rowNum: row.rowNum, error: e.message, suggestions: e.suggestions });
        } else {
          errors.push({ rowNum: row.rowNum, error: "Calculation failed" });
        }
      }
    }

    // Apply route cost-sharing: rows that share a route_name divide their fixed
    // cost heads (driver, vehicle, etc.) by the number of trips on that route.
    applyRouteAdjustments(results as unknown as AdjustableRow[]);

    return NextResponse.json({ results, errors });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Batch calculation failed" }, { status: 500 });
  }
}
