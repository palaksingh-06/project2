export function getBatchCsvTemplate(): string {
  const headers = [
    "body_type",
    "capacity_tons",
    "length_ft",
    "axles",
    "origin",
    "destination",
    "payload_tons",
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
  ];

  const exampleRow = [
    "open",   // body_type
    "16",     // capacity_tons
    "20",     // length_ft
    "2",      // axles
    "Delhi",  // origin
    "Mumbai", // destination
    "14",     // payload_tons
    "",       // truck_model_id (optional)
    "",       // mileage_kmpl (optional override)
    "",       // driver_per_day
    "",       // bata_per_trip
    "",       // night_halt_per_night
    "",       // depreciation_per_km
    "",       // vehicle_per_trip
    "",       // state_permit
    "",       // maintenance_per_km
    "",       // loading_per_ton
    "",       // idle_hours
    "",       // idle_cost_per_hour
    "",       // overhead_per_trip
    "",       // risk_pct (0–1)
    "",       // empty_return_pct (0–1)
  ];

  return [headers.join(","), exampleRow.join(",")].join("\r\n");
}
