import { NextResponse } from "next/server";
import { z } from "zod";
import { runCalculation, CalculationError } from "@/lib/zbc/run-calculation";

const overridesSchema = z
  .object({
    distance_km: z.number().positive().optional(),
    mileage_kmpl: z.number().positive().optional(),
    driver_per_day: z.number().nonnegative().optional(),
    bata_per_trip: z.number().nonnegative().optional(),
    night_halt_per_night: z.number().nonnegative().optional(),
    helper_per_day: z.number().nonnegative().optional(),
    maintenance_per_km: z.number().nonnegative().optional(),
    tyres_count: z.number().positive().optional(),
    tyres_cost_per_tyre: z.number().nonnegative().optional(),
    tyres_life_km: z.number().positive().optional(),
    ex_showroom_inr: z.number().positive().optional(),
    salvage_pct: z.number().min(0).max(1).optional(),
    life_years: z.number().positive().optional(),
    life_km: z.number().positive().optional(),
    depreciation_aging_share: z.number().min(0).max(1).optional(),
    depreciation_usage_share: z.number().min(0).max(1).optional(),
    insurance_per_year: z.number().nonnegative().optional(),
    road_tax_per_year: z.number().nonnegative().optional(),
    fitness_per_year: z.number().nonnegative().optional(),
    interest_per_year: z.number().nonnegative().optional(),
    gps_per_year: z.number().nonnegative().optional(),
    fastag_fee_per_year: z.number().nonnegative().optional(),
    rto_misc_per_year: z.number().nonnegative().optional(),
    tarpaulin_per_year: z.number().nonnegative().optional(),
    other_fixed_per_year: z.number().nonnegative().optional(),
    loading_per_ton: z.number().nonnegative().optional(),
    empty_return_pct: z.number().min(0).max(1).optional(),
    empty_km: z.number().nonnegative().optional(),
    state_permit: z.number().nonnegative().optional(),
    overhead_pct: z.number().min(0).max(1).optional(),
    profit_pct: z.number().min(0).max(1).optional(),
    terrain: z.enum(["Plain", "Hill"]).optional(),
  })
  .optional();

const bodySchema = z.object({
  truckId: z.string(),
  modelId: z.string().optional(),
  origin: z.string().min(1),
  destination: z.string().min(1),
  tripType: z.string().refine((val) => val === "one-way" || val === "two-way", {
    message: "tripType must be either 'one-way' or 'two-way'",
  }), 
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
