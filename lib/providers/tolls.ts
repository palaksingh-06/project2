import { getFallbackRates } from "@/lib/config";
import type { Provenance } from "@/lib/zbc/provenance";

export interface TollPlaza {
  name: string;
  tag_inr: number;
  road?: string;
  state?: string;
}

export interface TollEstimate {
  total_inr: number;
  plaza_count: number;
  provenance: Provenance;
  highway?: string;
  plazas_detail?: TollPlaza[];
}

// Maps our internal toll class to TollGuru vehicle types
const TOLLGURU_VEHICLE: Record<string, string> = {
  lcv: "2AxlesTruck",
  twoAxle: "2AxlesTruck",
  threeAxle: "3AxlesTruck",
  mav: "4AxlesTruck",
  fourAxle: "4AxlesTruck",
  fiveAxle: "5AxlesTruck",
  car: "2AxlesAuto",
};

interface TollGuruToll {
  name?: string;
  tagCost?: number;
  cashCost?: number;
  road?: string;
  state?: string;
  start?: { name?: string; road?: string; state?: string };
}

// ── TollGuru API toggle ───────────────────────────────────────────────────────
// Controlled by TOLLGURU_ENABLED env variable. While off, toll falls through to the
// ₹/km × distance estimate. Real FASTag rates enabled when set to "true".
async function tollFromTollGuru(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  tollClass: string
): Promise<{ total_inr: number; plaza_count: number; plazas_detail: TollPlaza[] } | null> {
  if (process.env.TOLLGURU_ENABLED !== "true") return null;

  const apiKey = process.env.TOLLGURU_API_KEY;
  if (!apiKey) {
    console.warn("[TollGuru] TOLLGURU_API_KEY not set — falling back to estimate");
    return null;
  }

  const vehicleType = TOLLGURU_VEHICLE[tollClass] ?? "2AxlesTruck";

  try {
    const body = {
      vehicle: { type: vehicleType },
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destination.lat, lng: destination.lng },
      serviceProvider: "osrm",
    };

    const res = await fetch(
      "https://apis.tollguru.com/toll/v2/origin-destination-waypoints",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      }
    );

    const rawText = await res.text();

    if (!res.ok) {
      console.error(`[TollGuru] HTTP ${res.status}:`, rawText.slice(0, 500));
      return null;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      console.error("[TollGuru] Invalid JSON response:", rawText.slice(0, 200));
      return null;
    }

    console.log("[TollGuru] Response keys:", Object.keys(data));

    // TollGuru v2 returns { routes: [...] }; pick best/first route
    const routesArr = data.routes as Record<string, unknown>[] | undefined;
    const route = (
      routesArr?.find((r) => (r.summary as Record<string, unknown>)?.hasTolls) ??
      routesArr?.[0] ??
      data.route ??
      data
    ) as Record<string, unknown>;

    const costs = (route.costs ?? route) as Record<string, unknown>;

    console.log("[TollGuru] costs keys:", Object.keys(costs));

    // Prefer FASTag (tag) cost — mandatory in India
    const total =
      (costs.tag as number | undefined) ??
      (costs.minimumTollCost as number | undefined) ??
      (costs.tagAndCash as number | undefined) ??
      (costs.cash as number | undefined);

    if (typeof total !== "number" || total < 0) {
      console.warn("[TollGuru] No usable toll cost in response. costs:", JSON.stringify(costs));
      return null;
    }

    const tollsRaw = (route.tolls ?? []) as TollGuruToll[];
    const plazas_detail: TollPlaza[] = tollsRaw
      .map((t) => ({
        name: t.name ?? t.start?.name ?? "Unnamed plaza",
        tag_inr: Math.round(t.tagCost ?? t.cashCost ?? 0),
        road: t.road ?? t.start?.road,
        state: t.state ?? t.start?.state,
      }))
      .filter((p) => p.tag_inr > 0);

    return {
      total_inr: Math.round(total),
      plaza_count: plazas_detail.length || tollsRaw.length,
      plazas_detail,
    };
  } catch (err) {
    console.error("[TollGuru] Fetch error:", err);
    return null;
  }
}

export async function getTollEstimate(
  _originName: string,
  _destinationName: string,
  tollClass: string,
  distance_km: number,
  originCoords?: { lat: number; lng: number },
  destCoords?: { lat: number; lng: number }
): Promise<TollEstimate> {
  // TollGuru — real per-plaza toll data for any Indian route
  if (originCoords && destCoords) {
    const tg = await tollFromTollGuru(originCoords, destCoords, tollClass);
    if (tg) {
      return {
        total_inr: tg.total_inr,
        plaza_count: tg.plaza_count,
        plazas_detail: tg.plazas_detail,
        provenance: {
          kind: "api",
          label: "TollGuru",
          detail: `${TOLLGURU_VEHICLE[tollClass] ?? tollClass} — real FASTag rates`,
        },
      };
    }
  }

  // Fallback: ₹/km estimate from config
  const fallback = getFallbackRates();
  const perKm =
    fallback.toll_per_km[tollClass as keyof typeof fallback.toll_per_km] ??
    fallback.toll_per_km.twoAxle ??
    2;
  const plazas = Math.max(
    1,
    Math.round((distance_km / 100) * fallback.typical_plazas_per_100km)
  );

  return {
    total_inr: Math.round(perKm * distance_km),
    plaza_count: plazas,
    provenance: {
      kind: "estimate",
      label: "₹/km × distance",
      detail: `config/fallback-rates.json (₹${perKm}/km for ${tollClass})`,
    },
  };
}
