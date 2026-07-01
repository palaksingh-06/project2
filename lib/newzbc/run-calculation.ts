import { getTruckModel, getTruckProfile, getTruckRatesConfig } from "@/lib/config";
import { geocode } from "@/lib/providers/geocode";
import { getDieselPrice } from "@/lib/providers/fuel";
import { getRouteDistance } from "@/lib/providers/routing";
import { getTollEstimate } from "@/lib/providers/tolls";
import type { TollEstimate } from "@/lib/providers/tolls";
import { buildCostHeadProvenance } from "@/lib/zbc/cost-head-provenance";
import { calculateZBC, tripDays } from "@/lib/zbc/calculate";
import { validateContributions } from "@/lib/zbc/validate";
import { CalculationError } from "@/lib/zbc/run-calculation";
import type { CalculationResponse } from "@/lib/zbc/run-calculation";
import type { RateOverrides, CostHeadId } from "@/lib/zbc/types";
import type { Provenance } from "@/lib/zbc/provenance";
import type { MultiStopCalculationRequest } from "@/lib/newzbc/types";

// Resolved location, or a degraded stand-in when geocoding failed but a
// distance_km override let the calculation proceed anyway.
interface ResolvedLocation {
  name: string;
  state: string;
  lat?: number;
  lng?: number;
  resolved_address?: string;
  provenance: Provenance;
  name_provenance?: Provenance;
}

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

export async function runCalculation(req: MultiStopCalculationRequest): Promise<CalculationResponse> {
  const { truckId, modelId, origin, destinations, tripType, payloadTons, overrides } = req;

  if (destinations.length === 0) {
    throw new CalculationError("At least one destination is required");
  }

  const profile = getTruckProfile(truckId);
  if (!profile) throw new CalculationError(`Unknown truck type: ${truckId}`);

  const config = getTruckRatesConfig();
  const warnings: string[] = [];
  const hasDistanceOverride = overrides?.distance_km !== undefined;

  // Geocode origin and all destinations in parallel
  const [originGeoResult, ...destGeoResults] = await Promise.all([
    geocode(origin),
    ...destinations.map((d) => geocode(d)),
  ]);

  // A manual distance override makes geocoding optional — the trip can still be
  // costed without resolved coordinates. Only fail hard when there's no override
  // to fall back on, since distance, tolls, and diesel state all depend on it otherwise.
  if (!originGeoResult.result && !hasDistanceOverride) {
    throw new CalculationError("Could not resolve origin", originGeoResult.suggestions);
  }
  for (let i = 0; i < destGeoResults.length; i++) {
    if (!destGeoResults[i].result && !hasDistanceOverride) {
      throw new CalculationError(
        `Could not resolve stop ${i + 1}: ${destinations[i]}`,
        destGeoResults[i].suggestions
      );
    }
  }

  const unresolvedProvenance: Provenance = {
    kind: "error",
    label: "Could not geocode — using distance override",
  };

  const o: ResolvedLocation = originGeoResult.result ?? {
    name: origin,
    state: "India",
    provenance: unresolvedProvenance,
  };
  const destResults: ResolvedLocation[] = destGeoResults.map(
    (r, i) => r.result ?? { name: destinations[i], state: "India", provenance: unresolvedProvenance }
  );
  const finalDest = destResults[destResults.length - 1];

  if (!originGeoResult.result) warnings.push(`Origin "${origin}" could not be geocoded — using distance override; tolls fall back to ₹/km estimate.`);
  destGeoResults.forEach((r, i) => {
    if (!r.result) warnings.push(`Stop ${i + 1} "${destinations[i]}" could not be geocoded — using distance override; tolls fall back to ₹/km estimate.`);
  });

  // Build leg endpoints: (origin→stop[0]), (stop[0]→stop[1]), …, (stop[n-2]→stop[n-1])
  const legFrom = [o, ...destResults.slice(0, -1)];
  const legTo = destResults;

  let totalDistance: number;
  let totalTollInr: number;
  let totalPlazaCount: number;
  let primaryDistanceProvenance: Provenance;
  let primaryToll: TollEstimate;
  let fuel: Awaited<ReturnType<typeof getDieselPrice>>;

  if (hasDistanceOverride) {
    // Manual distance override — applies to the whole multi-stop trip as a single
    // combined distance, skipping per-leg routing entirely (one user-supplied
    // number can't be meaningfully split back into individual legs).
    totalDistance = overrides!.distance_km!;
    primaryDistanceProvenance = {
      kind: "input",
      label: "User override",
      detail: "Advanced rates form",
    };
    [primaryToll, fuel] = await Promise.all([
      getTollEstimate(
        o.name,
        finalDest.name,
        profile.toll_class,
        totalDistance,
        originGeoResult.result ? { lat: o.lat!, lng: o.lng! } : undefined,
        destGeoResults[destGeoResults.length - 1].result ? { lat: finalDest.lat!, lng: finalDest.lng! } : undefined
      ),
      getDieselPrice(o.state),
    ]);
    totalTollInr = primaryToll.total_inr;
    totalPlazaCount = primaryToll.plaza_count;
    if (destinations.length > 1) {
      warnings.push("Distance override applies to the whole trip — per-leg distance/toll breakdown is not available for this calculation.");
    }
  } else {
    // Get distances for all legs in parallel
    const legDistances = await Promise.all(
      legFrom.map((from, i) =>
        getRouteDistance({ lat: from.lat!, lng: from.lng! }, { lat: legTo[i].lat!, lng: legTo[i].lng! })
      )
    );

    // Get tolls (with known per-leg distances) and fuel in parallel
    let legTolls: TollEstimate[];
    [legTolls, fuel] = await Promise.all([
      Promise.all(
        legFrom.map((from, i) =>
          getTollEstimate(
            from.name,
            legTo[i].name,
            profile.toll_class,
            legDistances[i].distance_km,
            { lat: from.lat!, lng: from.lng! },
            { lat: legTo[i].lat!, lng: legTo[i].lng! }
          )
        )
      ),
      getDieselPrice(o.state),
    ]);

    totalDistance = legDistances.reduce((sum, d) => sum + d.distance_km, 0);
    totalTollInr = legTolls.reduce((sum, t) => sum + t.total_inr, 0);
    totalPlazaCount = legTolls.reduce((sum, t) => sum + t.plaza_count, 0);
    primaryDistanceProvenance = legDistances[0].provenance;
    primaryToll = legTolls[0];

    // Warn if any leg relied on non-API data
    legDistances.forEach((d, i) =>
      warnIfNotApi(warnings, destinations.length > 1 ? `Leg ${i + 1} distance` : "Distance", d.provenance)
    );
    legTolls.forEach((t, i) =>
      warnIfNotApi(warnings, destinations.length > 1 ? `Leg ${i + 1} tolls` : "Tolls", t.provenance)
    );
  }

  warnIfNotApi(warnings, "Diesel", fuel.provenance);

  const payload = payloadTons ?? profile.payload_tons;
  const days = tripDays(totalDistance, config.avg_speed_kmh);

  const model = modelId ? getTruckModel(modelId) : null;
  const rateOverrides: RateOverrides | undefined = model
    ? { mileage_kmpl: Math.round(model.mileage_kmpl * 0.7 * 100) / 100, ...overrides }
    : (overrides as RateOverrides | undefined);

  const TIER_LABELS: Record<string, string> = {
    "exact-model": "Exact model ID",
    "alias": "Matched by alias map",
    "four-field": "4-field match (body/capacity/length/axles)",
    "filtered": "Filtered match",
  };

  const mileageUsed = rateOverrides?.mileage_kmpl ?? 0;

  const truckMeta = req.truckResolution
    ? {
        truck_id: req.truckResolution.truckId,
        truck_label: req.truckResolution.truckLabel,
        model_id: req.truckResolution.modelId,
        model_label: req.truckResolution.modelLabel,
        mileage_used: mileageUsed,
        provenance: {
          kind: "config" as const,
          label: TIER_LABELS[req.truckResolution.tier ?? "filtered"] ?? "Resolved from CSV",
        },
      }
    : {
        truck_id: truckId,
        truck_label: profile.label,
        model_id: modelId,
        mileage_used: mileageUsed,
        provenance: { kind: "input" as const, label: "Selected in form" },
      };

  // Use the combined total for the single ZBC calculation
  const combinedToll = {
    total_inr: totalTollInr,
    plaza_count: totalPlazaCount,
    provenance: primaryToll.provenance,
  };

  const result = calculateZBC({
    truckId,
    profile,
    payloadTons: payload,
    distance_km: totalDistance,
    days,
    diesel_price_inr: fuel.price_inr,
    toll: combinedToll,
    overrides: rateOverrides,
    avg_speed_kmh: config.avg_speed_kmh,
    trip_type: tripType ?? "one-way",
  });

  const contributions = validateContributions(result);
  const costHeadProvenance = buildCostHeadProvenance({
    toll: combinedToll.provenance,
    overrides: rateOverrides,
  });

  return {
    total: result.total_inr,
    subtotal: result.subtotal_inr,
    breakdown: result.lines.map((line) => ({
      ...line,
      pct:
        result.total_inr > 0
          ? Math.round((line.amount_inr / result.total_inr) * 1000) / 10
          : 0,
      provenance: costHeadProvenance[line.id as keyof typeof costHeadProvenance],
      ...(line.id === "toll" && primaryToll.plazas_detail?.length
        ? { toll_plazas: primaryToll.plazas_detail }
        : {}),
    })),
    contributions,
    meta: {
      trip_days: result.trip_days,
      distance_km: Math.round(totalDistance),
      origin: {
        name: o.name,
        state: o.state,
        lat: o.lat,
        lng: o.lng,
        resolved_address: o.resolved_address,
        provenance: o.provenance,
        name_provenance: o.name_provenance,
      },
      destination: {
        name: finalDest.name,
        state: finalDest.state,
        lat: finalDest.lat,
        lng: finalDest.lng,
        resolved_address: finalDest.resolved_address,
        provenance: finalDest.provenance,
        name_provenance: finalDest.name_provenance,
      },
      inputs: {
        geocode_origin: o.provenance,
        geocode_origin_name: o.name_provenance,
        geocode_destination: finalDest.provenance,
        geocode_destination_name: finalDest.name_provenance,
        distance: primaryDistanceProvenance,
        fuel: fuel.provenance,
        toll: combinedToll.provenance,
      },
      cost_heads: costHeadProvenance,
      toll: {
        plazas: totalPlazaCount,
        highway: primaryToll.highway,
      },
      fuel: {
        price_inr: fuel.price_inr,
        state: fuel.state,
      },
      truck: truckMeta,
    },
    warnings,
  };
}
