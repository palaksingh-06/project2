import { NextResponse } from "next/server";
import { z } from "zod";
import { getTruckModel, getTruckProfile, getTruckRatesConfig } from "@/lib/config";
import { geocode } from "@/lib/providers/geocode";
import { getDieselPrice } from "@/lib/providers/fuel";
import { getRouteDistance } from "@/lib/providers/routing";
import { getTollEstimate } from "@/lib/providers/tolls";
import { buildCostHeadProvenance } from "@/lib/zbc/cost-head-provenance";
import { calculateZBC, tripDays } from "@/lib/zbc/calculate";
import { validateContributions } from "@/lib/zbc/validate";
import type { RateOverrides } from "@/lib/zbc/types";

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

function warnIfNotApi(
  warnings: string[],
  label: string,
  p: { kind: string; label: string; detail?: string }
) {
  if (p.kind !== "api") {
    warnings.push(
      `${label}: ${p.kind === "config" ? "config file" : "estimate"} — ${p.label}${p.detail ? ` (${p.detail})` : ""}`
    );
  }
}

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

    const { truckId, modelId, origin, destination, payloadTons, overrides } =
      parsed.data;

    const profile = getTruckProfile(truckId);
    if (!profile) {
      return NextResponse.json(
        { error: `Unknown truck type: ${truckId}` },
        { status: 400 }
      );
    }

    const config = getTruckRatesConfig();
    const warnings: string[] = [];

    const [originGeo, destGeo] = await Promise.all([
      geocode(origin),
      geocode(destination),
    ]);

    if (!originGeo.result) {
      return NextResponse.json(
        {
          error: "Could not resolve origin",
          suggestions: originGeo.suggestions,
        },
        { status: 422 }
      );
    }
    if (!destGeo.result) {
      return NextResponse.json(
        {
          error: "Could not resolve destination",
          suggestions: destGeo.suggestions,
        },
        { status: 422 }
      );
    }

    const o = originGeo.result;
    const d = destGeo.result;

    const distanceResult = await getRouteDistance(
      { lat: o.lat, lng: o.lng },
      { lat: d.lat, lng: d.lng }
    );

    const [toll, fuel] = await Promise.all([
      getTollEstimate(
        o.name,
        d.name,
        profile.toll_class,
        distanceResult.distance_km,
        { lat: o.lat, lng: o.lng },
        { lat: d.lat, lng: d.lng }
      ),
      getDieselPrice(o.state),
    ]);

    warnIfNotApi(warnings, "Distance", distanceResult.provenance);
    warnIfNotApi(warnings, "Tolls", toll.provenance);
    warnIfNotApi(warnings, "Diesel", fuel.provenance);

    const payload = payloadTons ?? profile.payload_tons;
    const days = tripDays(
      distanceResult.distance_km,
      config.avg_speed_kmh
    );

    const model = modelId ? getTruckModel(modelId) : null;
    const rateOverrides: RateOverrides | undefined = model
      ? { mileage_kmpl: Math.round(model.mileage_kmpl * 0.7 * 100) / 100, ...overrides }
      : (overrides as RateOverrides | undefined);

    const result = calculateZBC({
      truckId,
      profile,
      payloadTons: payload,
      distance_km: distanceResult.distance_km,
      days,
      diesel_price_inr: fuel.price_inr,
      toll: {
        total_inr: toll.total_inr,
        plaza_count: toll.plaza_count,
        provenance: toll.provenance,
      },
      overrides: rateOverrides,
      avg_speed_kmh: config.avg_speed_kmh,
    });

    const contributions = validateContributions(result);

    const costHeadProvenance = buildCostHeadProvenance({
      distance: distanceResult.provenance,
      fuel: fuel.provenance,
      toll: toll.provenance,
      overrides: rateOverrides,
    });

    return NextResponse.json({
      total: result.total_inr,
      subtotal: result.subtotal_inr,
      breakdown: result.lines.map((line) => ({
        ...line,
        pct:
          result.total_inr > 0
            ? Math.round((line.amount_inr / result.total_inr) * 1000) / 10
            : 0,
        provenance: costHeadProvenance[line.id],
        // Per-row source labels shown in the UI detail panel
        sources: {
          ...(line.id === "fuel" ? {
            distance: `${distanceResult.provenance.label}${distanceResult.provenance.detail ? ` — ${distanceResult.provenance.detail}` : ""}`,
            diesel: `${fuel.provenance.label}${fuel.provenance.detail ? ` — ${fuel.provenance.detail}` : ""}`,
            ...(fuel.provenance.updated_at ? { diesel_updated: fuel.provenance.updated_at } : {}),
          } : {}),
          ...(line.id === "toll" ? {
            toll: `${toll.provenance.label}${toll.provenance.detail ? ` — ${toll.provenance.detail}` : ""}`,
          } : {}),
        },
        ...(line.id === "toll" && toll.plazas_detail?.length
          ? { toll_plazas: toll.plazas_detail }
          : {}),
      })),
      contributions,
      meta: {
        trip_days: result.trip_days,
        distance_km: Math.round(distanceResult.distance_km),
        origin: {
          name: o.name,
          state: o.state,
          provenance: o.provenance,
        },
        destination: {
          name: d.name,
          state: d.state,
          provenance: d.provenance,
        },
        inputs: {
          geocode_origin: o.provenance,
          geocode_destination: d.provenance,
          distance: distanceResult.provenance,
          fuel: fuel.provenance,
          toll: toll.provenance,
        },
        cost_heads: costHeadProvenance,
        toll: {
          plazas: toll.plaza_count,
          highway: toll.highway,
        },
        fuel: {
          price_inr: fuel.price_inr,
          state: fuel.state,
        },
      },
      warnings,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Calculation failed" },
      { status: 500 }
    );
  }
}
