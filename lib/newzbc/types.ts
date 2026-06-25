import type { RateOverrides } from "@/lib/zbc/types";

export interface MultiStopCalculationRequest {
  truckId: string;
  modelId?: string;
  origin: string;
  destinations: string[];  // sequential waypoints; legs: origin→[0]→[1]→…→[n-1]
  tripType?: string;
  payloadTons?: number;
  overrides?: RateOverrides;
  truckResolution?: {
    truckId: string;
    truckLabel: string;
    modelId?: string;
    modelLabel?: string;
    tier?: "exact-model" | "alias" | "four-field" | "filtered";
  };
}
