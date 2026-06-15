import { getTrucksByBodyType } from "@/lib/config";
import type { RateOverrides } from "@/lib/zbc/types";

// Tracks how a truck was resolved from CSV fields — which tier of lookup succeeded
export interface TruckResolution {
  truckId: string;
  truckLabel: string;
  modelId?: string;
  modelLabel?: string;
  tier?: "exact-model" | "alias" | "four-field" | "filtered";
}

export interface ValidatedRow {
  rowNum: number;
  truckId: string;
  modelId?: string;
  origin: string;
  destination: string;
  payloadTons: number;
  overrides?: RateOverrides;
  // Provenance for how the truck was resolved from CSV fields
  truckResolution: {
    truckId: string;
    truckLabel: string;
    modelId?: string;
    modelLabel?: string;
    tier: "exact-model" | "alias" | "four-field" | "filtered";
  };
}

export interface RowFieldError {
  column: string;
  message: string;
}

export interface RowError {
  rowNum: number;
  fields: RowFieldError[];
}

const REQUIRED_COLUMNS = [
  "body_type",
  "capacity_tons",
  "length_ft",
  "axles",
  "origin",
  "destination",
  "payload_tons",
] as const;

const OVERRIDE_COLUMNS = [
  "truck_model_id",
  "mileage_kmpl",
  "driver_per_day",
  "bata_per_trip",
  "night_halt_per_night",
  "depreciation_per_km",
  "vehicle_per_trip",
  "state_permit",
  "maintenance_per_km",
  "loading_per_ton",
  "idle_hours",
  "idle_cost_per_hour",
  "overhead_per_trip",
  "risk_pct",
  "empty_return_pct",
] as const;

export const MAX_BATCH_ROWS = 50;

function parseRow(rawLine: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function toNum(val: string): number | null {
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export function parseBatchCsv(csvText: string): {
  rows: ValidatedRow[];
  errors: RowError[];
} {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      rows: [],
      errors: [{ rowNum: 0, fields: [{ column: "file", message: "CSV must have a header row and at least one data row" }] }],
    };
  }

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  const dataLines = lines.slice(1);

  const missingRequired = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missingRequired.length > 0) {
    return {
      rows: [],
      errors: [
        {
          rowNum: 0,
          fields: missingRequired.map((c) => ({
            column: c,
            message: `Missing required column: ${c}`,
          })),
        },
      ],
    };
  }

  if (dataLines.length > MAX_BATCH_ROWS) {
    return {
      rows: [],
      errors: [
        {
          rowNum: 0,
          fields: [
            {
              column: "file",
              message: `CSV contains ${dataLines.length} rows. Maximum ${MAX_BATCH_ROWS} rows per batch. Please split into smaller files.`,
            },
          ],
        },
      ],
    };
  }

  const col = (row: string[], name: string): string => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  };

  const validRows: ValidatedRow[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const rowNum = i + 1;
    const cells = parseRow(dataLines[i]);
    const fieldErrors: RowFieldError[] = [];

    const bodyTypeRaw = col(cells, "body_type").toLowerCase();
    if (bodyTypeRaw !== "open" && bodyTypeRaw !== "closed") {
      fieldErrors.push({ column: "body_type", message: `Must be "open" or "closed", got "${bodyTypeRaw}"` });
    }
    const bodyType = bodyTypeRaw as "open" | "closed";

    const capacityRaw = col(cells, "capacity_tons");
    const capacityNum = toNum(capacityRaw);
    if (capacityNum === null || capacityNum <= 0) {
      fieldErrors.push({ column: "capacity_tons", message: `Must be a positive number, got "${capacityRaw}"` });
    }

    const lengthRaw = col(cells, "length_ft");
    const lengthNum = toNum(lengthRaw);
    if (lengthNum === null || lengthNum <= 0) {
      fieldErrors.push({ column: "length_ft", message: `Must be a positive number, got "${lengthRaw}"` });
    }

    const axlesRaw = col(cells, "axles");
    const axlesNum = toNum(axlesRaw);
    if (axlesNum === null || !Number.isInteger(axlesNum) || axlesNum < 2) {
      fieldErrors.push({ column: "axles", message: `Must be an integer >= 2, got "${axlesRaw}"` });
    }

    const origin = col(cells, "origin");
    if (!origin) fieldErrors.push({ column: "origin", message: "Origin city cannot be empty" });

    const destination = col(cells, "destination");
    if (!destination) fieldErrors.push({ column: "destination", message: "Destination city cannot be empty" });

    const payloadRaw = col(cells, "payload_tons");
    const payloadNum = toNum(payloadRaw);
    if (payloadNum === null || payloadNum <= 0) {
      fieldErrors.push({ column: "payload_tons", message: `Must be a positive number, got "${payloadRaw}"` });
    }

    // Hoist trucks/match so they are accessible when building truckResolution below
    let truckId: string | null = null;
    let resolvedMatch: { id: string; label: string } | null = null;
    if (fieldErrors.length === 0 && bodyType && capacityNum !== null && lengthNum !== null && axlesNum !== null) {
      const trucks = getTrucksByBodyType(bodyType);
      const match = trucks.find(
        (t) =>
          t.payload_tons === capacityNum &&
          t.length_ft === lengthNum &&
          t.axles === axlesNum
      );
      if (!match) {
        fieldErrors.push({
          column: "body_type/capacity_tons/length_ft/axles",
          message: `No truck found matching: ${bodyType} body, ${capacityNum}T, ${lengthNum}ft, ${axlesNum}-axle`,
        });
      } else {
        truckId = match.id;
        resolvedMatch = match;
      }
    }

    // Validate optional override columns
    const overrides: RateOverrides = {};
    let hasOverrides = false;

    const numericOverrides: Array<{ key: keyof RateOverrides; col: string; min?: number; max?: number; positive?: boolean }> = [
      { key: "mileage_kmpl", col: "mileage_kmpl", positive: true },
      { key: "driver_per_day", col: "driver_per_day", min: 0 },
      { key: "bata_per_trip", col: "bata_per_trip", min: 0 },
      { key: "night_halt_per_night", col: "night_halt_per_night", min: 0 },
      { key: "depreciation_per_km", col: "depreciation_per_km", min: 0 },
      { key: "vehicle_per_trip", col: "vehicle_per_trip", min: 0 },
      { key: "state_permit", col: "state_permit", min: 0 },
      { key: "maintenance_per_km", col: "maintenance_per_km", min: 0 },
      { key: "loading_per_ton", col: "loading_per_ton", min: 0 },
      { key: "idle_hours", col: "idle_hours", min: 0 },
      { key: "idle_cost_per_hour", col: "idle_cost_per_hour", min: 0 },
      { key: "overhead_per_trip", col: "overhead_per_trip", min: 0 },
      { key: "risk_pct", col: "risk_pct", min: 0, max: 1 },
      { key: "empty_return_pct", col: "empty_return_pct", min: 0, max: 1 },
    ];

    for (const { key, col: colName, min, max, positive } of numericOverrides) {
      const raw = col(cells, colName);
      if (!raw) continue;
      const n = toNum(raw);
      if (n === null) {
        fieldErrors.push({ column: colName, message: `Must be a number, got "${raw}"` });
        continue;
      }
      if (positive && n <= 0) {
        fieldErrors.push({ column: colName, message: `Must be positive, got ${n}` });
        continue;
      }
      if (min !== undefined && n < min) {
        fieldErrors.push({ column: colName, message: `Must be >= ${min}, got ${n}` });
        continue;
      }
      if (max !== undefined && n > max) {
        fieldErrors.push({ column: colName, message: `Must be <= ${max}, got ${n}` });
        continue;
      }
      (overrides as Record<string, number>)[key] = n;
      hasOverrides = true;
    }

    if (fieldErrors.length > 0) {
      errors.push({ rowNum, fields: fieldErrors });
      continue;
    }

    const modelIdRaw = col(cells, "truck_model_id");

    validRows.push({
      rowNum,
      truckId: truckId!,
      modelId: modelIdRaw || undefined,
      origin,
      destination,
      payloadTons: payloadNum!,
      overrides: hasOverrides ? overrides : undefined,
      // Provenance: current CSV path always resolves via 4-field match (body/capacity/length/axles)
      truckResolution: {
        truckId: truckId!,
        truckLabel: resolvedMatch?.label ?? truckId!,
        modelId: modelIdRaw || undefined,
        modelLabel: undefined,
        tier: "four-field",
      },
    });
  }

  return { rows: validRows, errors };
}
