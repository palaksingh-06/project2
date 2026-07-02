export function getBatchCsvTemplate(): string {
  const headers = [
    "body_type",
    "capacity_tons",
    "length_ft",
    "axles",
    "origin",
    "origin_lat_lng",
    "origin_lat",
    "origin_lng",
    "destination",
    "destination_lat_lng",
    "destination_lat",
    "destination_lng",
    "route_name",
    "payload_tons",
    "distance_km",
    "truck_model_id",
    "mileage_kmpl",
    "driver_per_day",
    "bata_per_trip",
    "night_halt_per_night",
    "maintenance_per_km",
    "state_permit",
    "loading_per_ton",
    "empty_return_pct",
  ];

  const exampleRow = [
    "open",   // body_type
    "16",     // capacity_tons
    "20",     // length_ft
    "2",      // axles
    "Delhi",  // origin
    "",       // origin_lat_lng  (optional — e.g. 28.6139,77.2090)
    "",       // origin_lat      (optional — use instead of origin_lat_lng)
    "",       // origin_lng      (optional — use instead of origin_lat_lng)
    "Mumbai", // destination
    "",       // destination_lat_lng  (optional — e.g. 19.0760,72.8777)
    "",       // destination_lat      (optional — use instead of destination_lat_lng)
    "",       // destination_lng      (optional — use instead of destination_lat_lng)
    "",       // route_name           (optional — e.g. "Route 1" or "1"; rows sharing a value are connected on the map)
    "14",     // payload_tons
    "",       // distance_km (optional override — replaces geocoded/routed distance)
    "",       // truck_model_id (optional)
    "",       // mileage_kmpl (optional override)
    "",       // driver_per_day
    "",       // bata_per_trip
    "",       // night_halt_per_night
    "",       // maintenance_per_km
    "",       // state_permit
    "",       // loading_per_ton
    "",       // empty_return_pct (0-1)
  ];

  return [headers.join(","), exampleRow.join(",")].join("\r\n");
}
