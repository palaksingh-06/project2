import { NextResponse } from "next/server";
import { z } from "zod";
import { runCalculation, CalculationError } from "@/lib/zbc/run-calculation";

const overridesSchema = z
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
  .optional();

const bodySchema = z.object({
  truckId: z.string(),
  modelId: z.string().optional(),
  origin: z.string().min(1),
  destination: z.string().min(1),
  payloadTons: z.number().positive().optional(),
  overrides: overridesSchema,
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await runCalculation(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof CalculationError) {
      return NextResponse.json(
        { error: e.message, suggestions: e.suggestions },
        { status: 422 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: "Calculation failed" }, { status: 500 });
  }
}
