import { getTruckModel, getTruckProfile, getTruckRatesConfig, getZbcGuidelines } from "@/lib/config";
import { geocode } from "@/lib/providers/geocode";
import { getDieselPrice } from "@/lib/providers/fuel";
import { getRouteDistance } from "@/lib/providers/routing";
import { getTollEstimate } from "@/lib/providers/tolls";
import { buildCostHeadProvenance } from "@/lib/zbc/cost-head-provenance";
import { calculateZBC, tripDays } from "@/lib/zbc/calculate";
import { lookupReturnLoad } from "@/lib/zbc/return-load-master";
import type { ReturnLoadInfo } from "@/lib/zbc/return-load-master";
import { validateContributions } from "@/lib/zbc/validate";
import type { RateOverrides, CostHeadId } from "@/lib/zbc/types";
import type { Provenance } from "@/lib/zbc/provenance";

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

export interface CalculationRequest {
  truckId: string;
  modelId?: string;
  origin: string;
  destination: string;
  tripType?: string;   // single-trip API always sends it; batch defaults to "one-way"
  payloadTons?: number;
  overrides?: RateOverrides;
  // Optional provenance from CSV batch parsing — records which resolution tier was used
  truckResolution?: {
    truckId: string;
    truckLabel: string;
    modelId?: string;
    modelLabel?: string;
    tier?: "exact-model" | "alias" | "four-field" | "filtered";
  };
}

export interface CalculationResponse {
  total: number;
  subtotal: number;
  breakdown: unknown[];
  contributions: unknown[];
  meta: {
    trip_days: number;
    distance_km: number;
    origin: { name: string; state: string; lat?: number; lng?: number; resolved_address?: string; provenance: Provenance; name_provenance?: Provenance };
    destination: { name: string; state: string; lat?: number; lng?: number; resolved_address?: string; provenance: Provenance; name_provenance?: Provenance };
    inputs: {
      geocode_origin: Provenance;
      geocode_origin_name?: Provenance;
      geocode_destination: Provenance;
      geocode_destination_name?: Provenance;
      distance: Provenance;
      fuel: Provenance;
      toll: Provenance;
    };
    cost_heads: Omit<Record<CostHeadId, Provenance>, "fuel">;
    toll: { plazas: number; highway?: string };
    fuel: { price_inr: number; state: string };
    truck?: {
      truck_id: string;
      truck_label: string;
      model_id?: string;
      model_label?: string;
      mileage_used: number;
      provenance: Provenance;
    };
  };
  warnings: string[];
  market_rate_estimate_inr?: number;
  return_load?: ReturnLoadInfo;
}

function warnIfNotApi(
  warnings: string[],
  label: string,
  p: { kind: string; label: string; detail?: string }
) {
  if (p.kind !== "api") {
    const kindLabel = p.kind === "config" ? "config file" : p.kind === "input" ? "manual override" : "estimate";
    warnings.push(
      `${label}: ${kindLabel} — ${p.label}${p.detail ? ` (${p.detail})` : ""}`
    );
  }
}

export class CalculationError extends Error {
  constructor(
    message: string,
    public readonly suggestions?: string[]
  ) {
    super(message);
  }
}

export async function runCalculation(req: CalculationRequest): Promise<CalculationResponse> {
  const { truckId, modelId, origin, destination, tripType, payloadTons, overrides } = req;

  const profile = getTruckProfile(truckId);
  if (!profile) throw new CalculationError(`Unknown truck type: ${truckId}`);

  const config = getTruckRatesConfig();
  const warnings: string[] = [];

  const hasDistanceOverride = overrides?.distance_km !== undefined;

  const [originGeo, destGeo] = await Promise.all([
    geocode(origin),
    geocode(destination),
  ]);

  // A manual distance override makes geocoding optional — the trip can still be
  // costed without resolved coordinates. Only fail hard when there's no override
  // to fall back on, since distance, tolls, and diesel state all depend on it otherwise.
  if (!originGeo.result && !hasDistanceOverride) {
    throw new CalculationError("Could not resolve origin", originGeo.suggestions);
  }
  if (!destGeo.result && !hasDistanceOverride) {
    throw new CalculationError("Could not resolve destination", destGeo.suggestions);
  }

  const unresolvedProvenance: Provenance = {
    kind: "error",
    label: "Could not geocode — using distance override",
  };

  const o: ResolvedLocation = originGeo.result ?? {
    name: origin,
    state: "India",
    provenance: unresolvedProvenance,
  };
  const d: ResolvedLocation = destGeo.result ?? {
    name: destination,
    state: "India",
    provenance: unresolvedProvenance,
  };

  if (!originGeo.result) warnings.push(`Origin "${origin}" could not be geocoded — using distance override; tolls fall back to ₹/km estimate.`);
  if (!destGeo.result) warnings.push(`Destination "${destination}" could not be geocoded — using distance override; tolls fall back to ₹/km estimate.`);

  // Manual distance override — skips the routing API call entirely when provided
  // (geocoding still runs above for diesel-price state lookup and the toll API).
  const distanceResult =
    overrides?.distance_km !== undefined
      ? {
          distance_km: overrides.distance_km,
          provenance: {
            kind: "input" as const,
            label: "User override",
            detail: "Advanced rates form",
          },
        }
      : await getRouteDistance(
          { lat: o.lat!, lng: o.lng! },
          { lat: d.lat!, lng: d.lng! }
        );

  const [toll, fuel] = await Promise.all([
    getTollEstimate(
      o.name,
      d.name,
      profile.toll_class,
      distanceResult.distance_km,
      originGeo.result ? { lat: o.lat!, lng: o.lng! } : undefined,
      destGeo.result ? { lat: d.lat!, lng: d.lng! } : undefined
    ),
    getDieselPrice(o.state),
  ]);

  warnIfNotApi(warnings, "Distance", distanceResult.provenance);
  warnIfNotApi(warnings, "Tolls", toll.provenance);
  warnIfNotApi(warnings, "Diesel", fuel.provenance);

  const payload = payloadTons ?? profile.payload_tons;
  const days = tripDays(distanceResult.distance_km, config.avg_speed_kmh);

  const model = modelId ? getTruckModel(modelId) : null;
  const rateOverrides: RateOverrides | undefined = model
    ? { mileage_kmpl: Math.round(model.mileage_kmpl * 0.7 * 100) / 100, ...overrides }
    : (overrides as RateOverrides | undefined);

  // Human-readable labels for each resolution tier
  const TIER_LABELS: Record<string, string> = {
    "exact-model": "Exact model ID",
    "alias": "Matched by alias map",
    "four-field": "4-field match (body/capacity/length/axles)",
    "filtered": "Filtered match",
  };

  // mileage from the model override if present, else 0 (unknown until calculate runs)
  const mileageUsed = rateOverrides?.mileage_kmpl ?? 0;

  // Build truck provenance — from CSV batch (truckResolution present) or from form input
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

  // Lookup return load before calculateZBC call so terrain is available
  const returnLoad = lookupReturnLoad(d.name, d.state);

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
    trip_type: tripType ?? "one-way",
    guidelines: getZbcGuidelines(),
    terrain: returnLoad?.terrain === "Hill" ? "Hill" : "Plain",
  });
  const marketRateEstimate = returnLoad
    ? Math.round(result.total_inr * returnLoad.multiplier)
    : undefined;

  const contributions = validateContributions(result);
  const costHeadProvenance = buildCostHeadProvenance({
    toll: toll.provenance,
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
        lat: o.lat,
        lng: o.lng,
        resolved_address: o.resolved_address,
        provenance: o.provenance,
        name_provenance: o.name_provenance,
      },
      destination: {
        name: d.name,
        state: d.state,
        lat: d.lat,
        lng: d.lng,
        resolved_address: d.resolved_address,
        provenance: d.provenance,
        name_provenance: d.name_provenance,
      },
      inputs: {
        geocode_origin: o.provenance,
        geocode_origin_name: o.name_provenance,
        geocode_destination: d.provenance,
        geocode_destination_name: d.name_provenance,
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
      truck: truckMeta,
    },
    warnings,
    market_rate_estimate_inr: marketRateEstimate,
    return_load: returnLoad ?? undefined,
  };
}
