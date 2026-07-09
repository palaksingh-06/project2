import type { RateOverrides, CostHeadId } from "@/lib/zbc/types";

export interface MultiStopCalculationRequest {
  truckId: string;
  modelId?: string;
  routes: string[]; // ordered waypoints: origin, ...stops, destination. Minimum length 2.
  tripType?: string;
  payloadTons?: number;
  overrides?: RateOverrides;
  /** Cost head IDs to fully omit from this calculation (Configuration tab toggles). */
  excluded_heads?: CostHeadId[];
  truckResolution?: {
    truckId: string;
    truckLabel: string;
    modelId?: string;
    modelLabel?: string;
    tier?: "exact-model" | "alias" | "four-field" | "filtered";
  };
}
