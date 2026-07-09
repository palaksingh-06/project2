import { getFallbackRates } from "@/lib/config";
import type { Provenance } from "@/lib/zbc/provenance";
import type { RouteGeometry } from "@/lib/providers/routing";

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

// Shared by both TollGuru endpoints below — confirmed identical `costs`/`tolls`
// field names between the origin-destination-waypoints and the
// complete-polyline-from-mapping-service responses.
function extractTollGuruCosts(
  route: Record<string, unknown>
): { total_inr: number; plaza_count: number; plazas_detail: TollPlaza[] } | null {
  const costs = (route.costs ?? route) as Record<string, unknown>;

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

    return extractTollGuruCosts(route);
  } catch (err) {
    console.error("[TollGuru] Fetch error:", err);
    return null;
  }
}

// Whole-route TollGuru call — takes the already-routed geometry (from Google/ORS
// via getRoute()) and asks TollGuru for tolls along that EXACT path in one call,
// instead of letting TollGuru compute its own route per leg.
async function tollFromTollGuruRoute(
  geometry: RouteGeometry,
  mapProvider: "google" | "osm",
  tollClass: string
): Promise<{ total_inr: number; plaza_count: number; plazas_detail: TollPlaza[] } | null> {
  if (process.env.TOLLGURU_ENABLED !== "true") return null;

  const apiKey = process.env.TOLLGURU_API_KEY;
  if (!apiKey) {
    console.warn("[TollGuru] TOLLGURU_API_KEY not set — falling back to estimate");
    return null;
  }

  const vehicleType = TOLLGURU_VEHICLE[tollClass] ?? "2AxlesTruck";
  // TollGuru's "path" wants lat,lng pairs delimited by "|" — the reverse of
  // our geometry's [lng,lat] GeoJSON order.
  const path = geometry.coordinates.map(([lng, lat]) => `${lat},${lng}`).join("|");

  try {
    const body = {
      mapProvider,
      path,
      vehicle: { type: vehicleType },
      units: { currencyUnit: "INR" }, // request defaults to USD otherwise
    };

    const res = await fetch(
      "https://apis.tollguru.com/toll/v2/complete-polyline-from-mapping-service",
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
      console.error(`[TollGuru] Route-polyline HTTP ${res.status}:`, rawText.slice(0, 500));
      return null;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      console.error("[TollGuru] Route-polyline invalid JSON response:", rawText.slice(0, 200));
      return null;
    }

    if (data.status !== "OK") {
      console.warn("[TollGuru] Route-polyline non-OK status:", data.status);
      return null;
    }

    const route = data.route as Record<string, unknown> | undefined;
    if (!route) return null;

    return extractTollGuruCosts(route);
  } catch (err) {
    console.error("[TollGuru] Route-polyline fetch error:", err);
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

  // Short intra-city hops have no highway toll plazas when using the estimate.
  // This only applies to the fallback — TollGuru returns actual plaza data
  // and may legitimately return a non-zero toll even for short distances.
  if (distance_km < 30) {
    return {
      total_inr: 0,
      plaza_count: 0,
      provenance: {
        kind: "estimate",
        label: "₹/km × distance",
        detail: "toll-free below 30 km (fallback estimate)",
      },
    };
  }

  return {
    total_inr: Math.round(perKm * distance_km),
    plaza_count: 0,
    provenance: {
      kind: "estimate",
      label: "₹/km × distance",
      detail: `config/fallback-rates.json (₹${perKm}/km for ${tollClass})`,
    },
  };
}

export interface RouteTollInput {
  geometry: RouteGeometry;
  distance_km: number; // used only for the local fallback estimate below, never sent to TollGuru
  source: "google" | "ors" | "estimate";
}

// Whole-route counterpart to getTollEstimate — call once per trip with the
// entire routed geometry instead of once per leg.
export async function getTollEstimateForRoute(
  route: RouteTollInput,
  tollClass: string
): Promise<TollEstimate> {
  // A synthesized straight-line geometry (no real API routing data) doesn't
  // follow actual roads, so sending it to TollGuru would waste a call and
  // return meaningless plaza data — go straight to the local estimate instead.
  if (route.source !== "estimate") {
    const mapProvider = route.source === "google" ? "google" : "osm";
    const tg = await tollFromTollGuruRoute(route.geometry, mapProvider, tollClass);
    if (tg) {
      return {
        total_inr: tg.total_inr,
        plaza_count: tg.plaza_count,
        plazas_detail: tg.plazas_detail,
        provenance: {
          kind: "api",
          label: "TollGuru",
          detail: `${TOLLGURU_VEHICLE[tollClass] ?? tollClass} — real FASTag rates (whole route)`,
        },
      };
    }
  }

  // Fallback: ₹/km estimate from config, applied to the whole trip's distance.
  const fallback = getFallbackRates();
  const perKm =
    fallback.toll_per_km[tollClass as keyof typeof fallback.toll_per_km] ??
    fallback.toll_per_km.twoAxle ??
    2;

  if (route.distance_km < 30) {
    return {
      total_inr: 0,
      plaza_count: 0,
      provenance: {
        kind: "estimate",
        label: "₹/km × distance",
        detail: "toll-free below 30 km (fallback estimate)",
      },
    };
  }

  return {
    total_inr: Math.round(perKm * route.distance_km),
    plaza_count: 0,
    provenance: {
      kind: "estimate",
      label: "₹/km × distance",
      detail: `config/fallback-rates.json (₹${perKm}/km for ${tollClass})`,
    },
  };
}
