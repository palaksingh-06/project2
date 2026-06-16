import {
  getTrucksByBodyType,
  getTruckModel,
  getTruckProfile,
  getTruckAliases,
} from "@/lib/config";
import type { RateOverrides } from "@/lib/zbc/types";

export interface ValidatedRow {
  rowNum: number;
  truckId: string;
  modelId?: string;
  origin: string;
  destination: string;
  payloadTons: number;
  routeName?: string;
  // Human-readable label of the resolved truck — written to the Excel "Truck" column
  resolvedTruckLabel: string;
  overrides?: RateOverrides;
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

// Only these three columns are always required.
// Truck identification uses truck_model_id and/or the optional hint columns
// (body_type, capacity_tons, length_ft, axles).
const REQUIRED_COLUMNS = [
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

export const MAX_BATCH_ROWS = 200;

// ── Truck resolution ─────────────────────────────────────────────────────────

interface TruckResolution {
  truckId: string;
  truckLabel: string;
  modelId?: string;
  modelLabel?: string;
  tier?: "exact-model" | "alias" | "four-field" | "filtered";
}

// Returns all trucks (open + closed) with body_type attached
function getAllTrucks(): Array<{
  id: string;
  label: string;
  body_type: "open" | "closed";
  payload_tons: number;
  length_ft: number;
  axles: number;
}> {
  const open = getTrucksByBodyType("open").map((t) => ({ ...t, body_type: "open" as const }));
  const closed = getTrucksByBodyType("closed").map((t) => ({ ...t, body_type: "closed" as const }));
  return [...open, ...closed];
}

// Extracts truck attributes from freeform text using regex — no AI needed.
// The attribute space is small and numeric (feet, tons, axles) or keyword-based (open/closed),
// so simple patterns reliably cover real-world descriptions like "9 feet vehicle" or "9ft open 1T".
function extractFeaturesFromText(text: string): {
  bodyType?: "open" | "closed";
  capacityTons?: number;
  lengthFt?: number;
  axles?: number;
} {
  const lower = text.toLowerCase();

  const feetMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)/);
  const tonsMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:t\b|ton\b|tons\b|tonne\b|tonnes\b)/);
  const axlesMatch = lower.match(/(\d+)\s*(?:axle\b|axles\b)/);

  const bodyType: "open" | "closed" | undefined = /\bopen\b/.test(lower)
    ? "open"
    : /\b(?:closed|box|container|covered)\b/.test(lower)
    ? "closed"
    : undefined;

  return {
    bodyType,
    capacityTons: tonsMatch ? parseFloat(tonsMatch[1]) : undefined,
    lengthFt: feetMatch ? parseFloat(feetMatch[1]) : undefined,
    axles: axlesMatch ? parseInt(axlesMatch[1], 10) : undefined,
  };
}

// Normalizes freeform truck text for alias matching: lowercase, punctuation → space,
// collapse whitespace. So "Bolero-Pickup", "bolero pickup", "BOLERO/PICKUP" all become
// "bolero pickup" and match the same alias key.
function normalizeAliasText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Resolves an alias value (which may be either a model ID or a truck-class ID)
// into a TruckResolution. Model IDs are preferred since they carry mileage.
function resolveByModelOrClass(value: string): TruckResolution | null {
  const model = getTruckModel(value);
  if (model) {
    const profile = getTruckProfile(model.truck_class);
    return {
      truckId: model.truck_class,
      truckLabel: profile?.label ?? model.label,
      modelId: value,
      modelLabel: model.label,
    };
  }
  const profile = getTruckProfile(value);
  if (profile) {
    return { truckId: value, truckLabel: profile.label };
  }
  return null;
}

// Looks up freeform text against the editable alias map. Matches when the
// normalized input equals, contains, or is contained by a normalized alias key
// (keys must be >= 3 chars to avoid spurious matches). The longest matching key
// wins so more specific aliases ("bolero pickup") beat generic ones ("bolero").
function matchAlias(text: string): TruckResolution | null {
  const norm = normalizeAliasText(text);
  if (!norm) return null;
  const aliases = getTruckAliases();

  let bestKey = "";
  let bestValue = "";
  for (const [key, value] of Object.entries(aliases)) {
    const nKey = normalizeAliasText(key);
    if (nKey.length < 3) continue;
    const matches =
      norm === nKey || norm.includes(nKey) || nKey.includes(norm);
    if (matches && nKey.length > bestKey.length) {
      bestKey = nKey;
      bestValue = value;
    }
  }

  return bestValue ? resolveByModelOrClass(bestValue) : null;
}

// Resolves a truck in four tiers:
// Tier 1   — exact truck_model_id key (e.g. "tata-ace-carry")
// Tier 1.5 — editable alias map (e.g. "Bolero-Pickup" → bolero_open)
// Tier 2   — 4-field exact match when all four hint columns are filled
// Tier 3   — regex extraction from truck_model_id text + any provided column hints
function resolveTruck(
  modelIdRaw: string,
  hints: {
    bodyType?: "open" | "closed";
    capacityTons?: number;
    lengthFt?: number;
    axles?: number;
  }
): TruckResolution | { error: string } {
  // ── Tier 1: exact model ID lookup ──────────────────────────────────────────
  if (modelIdRaw) {
    const model = getTruckModel(modelIdRaw);
    if (model) {
      const profile = getTruckProfile(model.truck_class);
      return {
        truckId: model.truck_class,
        truckLabel: profile?.label ?? model.label,
        modelId: modelIdRaw,
        modelLabel: model.label,
        tier: "exact-model",
      };
    }

    // ── Tier 1.5: editable alias map ─────────────────────────────────────────
    // Catches human-friendly names like "Bolero-Pickup", "Tata Ace/Carry", "Intra"
    const aliased = matchAlias(modelIdRaw);
    if (aliased) return { ...aliased, tier: "alias" };
  }

  // ── Merge CSV column hints with features extracted from the text ───────────
  // CSV columns take priority; text extraction fills in anything not explicitly set
  let { bodyType, capacityTons, lengthFt, axles } = hints;
  if (modelIdRaw) {
    const extracted = extractFeaturesFromText(modelIdRaw);
    bodyType = bodyType ?? extracted.bodyType;
    capacityTons = capacityTons ?? extracted.capacityTons;
    lengthFt = lengthFt ?? extracted.lengthFt;
    axles = axles ?? extracted.axles;
  }

  // ── Tier 2: 4-field exact match ────────────────────────────────────────────
  if (
    bodyType !== undefined &&
    capacityTons !== undefined &&
    lengthFt !== undefined &&
    axles !== undefined
  ) {
    const trucks = getTrucksByBodyType(bodyType);
    const match = trucks.find(
      (t) =>
        t.payload_tons === capacityTons &&
        t.length_ft === lengthFt &&
        t.axles === axles
    );
    if (match) {
      const profile = getTruckProfile(match.id);
      return { truckId: match.id, truckLabel: profile?.label ?? match.label, tier: "four-field" };
    }
    // Fall through to Tier 3 for a clearer error that lists candidates
  }

  // ── Tier 3: filter all trucks by whatever attributes are known ─────────────
  const all = getAllTrucks();
  const candidates = all.filter((t) => {
    if (bodyType !== undefined && t.body_type !== bodyType) return false;
    if (capacityTons !== undefined && t.payload_tons !== capacityTons) return false;
    if (lengthFt !== undefined && t.length_ft !== lengthFt) return false;
    if (axles !== undefined && t.axles !== axles) return false;
    return true;
  });

  if (candidates.length === 1) {
    const profile = getTruckProfile(candidates[0].id);
    return { truckId: candidates[0].id, truckLabel: profile?.label ?? candidates[0].label, tier: "filtered" };
  }

  if (candidates.length === 0) {
    const parts: string[] = [];
    if (bodyType) parts.push(`${bodyType} body`);
    if (capacityTons !== undefined) parts.push(`${capacityTons}T`);
    if (lengthFt !== undefined) parts.push(`${lengthFt}ft`);
    if (axles !== undefined) parts.push(`${axles}-axle`);
    return {
      error:
        parts.length > 0
          ? `No truck found matching: ${parts.join(", ")}. Check available trucks in truck-rates.json.`
          : `Cannot identify truck. Provide truck_model_id (exact model ID or text like "9ft open 1T") or fill in body_type, capacity_tons, length_ft, and axles.`,
    };
  }

  // Multiple candidates — tell the user which ones matched so they can narrow it down
  return {
    error: `Ambiguous — ${candidates.length} trucks match the given info. Add more detail. Options: ${candidates.map((c) => c.label).join(" | ")}`,
  };
}

// ── CSV parsing utilities ─────────────────────────────────────────────────────

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

// ── Shared row validator ──────────────────────────────────────────────────────
// Called by both parseBatchCsv and the Excel parser in BatchUpload.tsx.
// `headers` must already be lowercased; `dataRows` must be string[][].

export function validateBatchRows(
  headers: string[],
  dataRows: string[][]
): { rows: ValidatedRow[]; errors: RowError[] } {
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

  if (dataRows.length > MAX_BATCH_ROWS) {
    return {
      rows: [],
      errors: [
        {
          rowNum: 0,
          fields: [
            {
              column: "file",
              message: `File contains ${dataRows.length} rows. Maximum ${MAX_BATCH_ROWS} rows per batch. Please split into smaller files.`,
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

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 1;
    const cells = dataRows[i];
    const fieldErrors: RowFieldError[] = [];

    // ── Origin ────────────────────────────────────────────────────────────────
    const originCity = col(cells, "origin");
    const originLatLng = col(cells, "origin_lat_lng");
    const originLat = col(cells, "origin_lat");
    const originLng = col(cells, "origin_lng");
    const originCoords =
      originLat && originLng ? `${originLat}, ${originLng}` : originLatLng;
    const origin = originCoords || originCity;
    if (!origin)
      fieldErrors.push({
        column: "origin",
        message:
          "Provide origin city, origin_lat_lng, or origin_lat + origin_lng",
      });

    // ── Destination ───────────────────────────────────────────────────────────
    const destinationCity = col(cells, "destination");
    const destinationLatLng = col(cells, "destination_lat_lng");
    const destinationLat = col(cells, "destination_lat");
    const destinationLng = col(cells, "destination_lng");
    const destinationCoords =
      destinationLat && destinationLng
        ? `${destinationLat}, ${destinationLng}`
        : destinationLatLng;
    const destination = destinationCoords || destinationCity;
    if (!destination)
      fieldErrors.push({
        column: "destination",
        message:
          "Provide destination city, destination_lat_lng, or destination_lat + destination_lng",
      });

    // ── Payload (always required) ─────────────────────────────────────────────
    const payloadRaw = col(cells, "payload_tons");
    const payloadNum = toNum(payloadRaw);
    if (payloadNum === null || payloadNum <= 0) {
      fieldErrors.push({
        column: "payload_tons",
        message: `Must be a positive number, got "${payloadRaw}"`,
      });
    }

    // ── Truck hint columns (all optional — blank = unknown, non-blank = hint) ─
    // body_type: only valid if "open" or "closed"; otherwise silently treated as unknown
    const bodyTypeRaw = col(cells, "body_type").toLowerCase();
    const bodyTypeHint: "open" | "closed" | undefined =
      bodyTypeRaw === "open" || bodyTypeRaw === "closed"
        ? bodyTypeRaw
        : undefined;

    // capacity_tons: if provided must be a positive number, else ignored
    const capacityRaw = col(cells, "capacity_tons");
    let capacityHint: number | undefined;
    if (capacityRaw) {
      const n = toNum(capacityRaw);
      if (n !== null && n > 0) {
        capacityHint = n;
      } else {
        fieldErrors.push({
          column: "capacity_tons",
          message: `If provided, must be a positive number, got "${capacityRaw}"`,
        });
      }
    }

    // length_ft: if provided must be a positive number, else ignored
    const lengthRaw = col(cells, "length_ft");
    let lengthHint: number | undefined;
    if (lengthRaw) {
      const n = toNum(lengthRaw);
      if (n !== null && n > 0) {
        lengthHint = n;
      } else {
        fieldErrors.push({
          column: "length_ft",
          message: `If provided, must be a positive number, got "${lengthRaw}"`,
        });
      }
    }

    // axles: if provided must be an integer >= 2, else ignored
    const axlesRaw = col(cells, "axles");
    let axlesHint: number | undefined;
    if (axlesRaw) {
      const n = toNum(axlesRaw);
      if (n !== null && Number.isInteger(n) && n >= 2) {
        axlesHint = n;
      } else {
        fieldErrors.push({
          column: "axles",
          message: `If provided, must be an integer >= 2, got "${axlesRaw}"`,
        });
      }
    }

    // ── Truck resolution ──────────────────────────────────────────────────────
    const modelIdRaw = col(cells, "truck_model_id");
    const resolved = resolveTruck(modelIdRaw, {
      bodyType: bodyTypeHint,
      capacityTons: capacityHint,
      lengthFt: lengthHint,
      axles: axlesHint,
    });

    if ("error" in resolved) {
      fieldErrors.push({
        column: "truck_model_id / body_type / capacity_tons / length_ft / axles",
        message: resolved.error,
      });
    }

    // ── Optional numeric override columns ─────────────────────────────────────
    const overrides: RateOverrides = {};
    let hasOverrides = false;

    const numericOverrides: Array<{
      key: keyof RateOverrides;
      col: string;
      min?: number;
      max?: number;
      positive?: boolean;
    }> = [
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

    const routeNameRaw = col(cells, "route_name");
    const truckRes = resolved as TruckResolution;

    validRows.push({
      rowNum,
      truckId: truckRes.truckId,
      modelId: truckRes.modelId,
      origin,
      destination,
      payloadTons: payloadNum!,
      routeName: routeNameRaw || undefined,
      resolvedTruckLabel: truckRes.truckLabel,
      overrides: hasOverrides ? overrides : undefined,
      truckResolution: {
        truckId: truckRes.truckId,
        truckLabel: truckRes.truckLabel,
        modelId: truckRes.modelId,
        modelLabel: truckRes.modelLabel,
        tier: truckRes.tier ?? "filtered",
      },
    });
  }

  return { rows: validRows, errors };
}

// ── CSV parser ─────────────────────────────────────────────────────────────────

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
      errors: [
        {
          rowNum: 0,
          fields: [{ column: "file", message: "File must have a header row and at least one data row" }],
        },
      ],
    };
  }

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  const dataRows = lines.slice(1).map(parseRow);
  return validateBatchRows(headers, dataRows);
}
