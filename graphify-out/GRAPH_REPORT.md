# Graph Report - .  (2026-05-25)

## Corpus Check
- Corpus is ~7,581 words - fits in a single context window. You may not need a graph.

## Summary
- 426 nodes · 565 edges · 45 communities (21 shown, 24 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.87)
- Token cost: 6,200 input · 1,800 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Calculate API & Validation|Calculate API & Validation]]
- [[_COMMUNITY_Toll Rate Corridors|Toll Rate Corridors]]
- [[_COMMUNITY_Cost Head Contribution Benchmarks|Cost Head Contribution Benchmarks]]
- [[_COMMUNITY_Project Dependencies|Project Dependencies]]
- [[_COMMUNITY_Frontend UI & Response Types|Frontend UI & Response Types]]
- [[_COMMUNITY_Truck Rate Profile A|Truck Rate Profile A]]
- [[_COMMUNITY_API Routes & Pages|API Routes & Pages]]
- [[_COMMUNITY_Truck Rate Profile B|Truck Rate Profile B]]
- [[_COMMUNITY_Truck Rate Profile C|Truck Rate Profile C]]
- [[_COMMUNITY_Truck Rate Profile D|Truck Rate Profile D]]
- [[_COMMUNITY_Geocoding & City Lookup|Geocoding & City Lookup]]
- [[_COMMUNITY_TypeScript Build Config|TypeScript Build Config]]
- [[_COMMUNITY_External API Providers|External API Providers]]
- [[_COMMUNITY_Fuel Price Provider|Fuel Price Provider]]
- [[_COMMUNITY_Truck Config & Documentation|Truck Config & Documentation]]
- [[_COMMUNITY_ESLint Linting Config|ESLint Linting Config]]
- [[_COMMUNITY_Data Provenance System|Data Provenance System]]
- [[_COMMUNITY_App Root Layout|App Root Layout]]
- [[_COMMUNITY_CSS Build Tools|CSS Build Tools]]
- [[_COMMUNITY_Tailwind Config Detail|Tailwind Config Detail]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_App Package|App Package]]
- [[_COMMUNITY_ESLint|ESLint]]
- [[_COMMUNITY_Next.js Config Detail|Next.js Config Detail]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Vitest Config Detail|Vitest Config Detail]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_Fuel Provider|Fuel Provider]]
- [[_COMMUNITY_Geocode Provider|Geocode Provider]]
- [[_COMMUNITY_Routing Provider|Routing Provider]]
- [[_COMMUNITY_Tolls Provider|Tolls Provider]]
- [[_COMMUNITY_Haversine Utility|Haversine Utility]]
- [[_COMMUNITY_Spellcheck Utility|Spellcheck Utility]]
- [[_COMMUNITY_ZBC Calculator|ZBC Calculator]]
- [[_COMMUNITY_Provenance Builder|Provenance Builder]]
- [[_COMMUNITY_Provenance Types|Provenance Types]]
- [[_COMMUNITY_ZBC Types|ZBC Types]]
- [[_COMMUNITY_Calculate Input|Calculate Input]]
- [[_COMMUNITY_Cost Line Type|Cost Line Type]]
- [[_COMMUNITY_ZBC Validator|ZBC Validator]]

## God Nodes (most connected - your core abstractions)
1. `9T_4W` - 21 edges
2. `16T_6W` - 21 edges
3. `25T_10W` - 21 edges
4. `32T_12W` - 21 edges
5. `Provenance` - 20 edges
6. `compilerOptions` - 16 edges
7. `POST()` - 12 edges
8. `diesel_by_state` - 11 edges
9. `contribution_ranges` - 11 edges
10. `geocode()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Geocode Provider (geocode)` --semantically_similar_to--> `Cities Cache (Indian Cities Data)`  [INFERRED] [semantically similar]
  lib/providers/geocode.ts → config/cities-cache.json
- `Fallback Rates Config` --rationale_for--> `Graceful Degradation / Fallback Chain Rationale`  [INFERRED]
  config/fallback-rates.json → README.md
- `calculateZBC()` --rationale_for--> `Zero-Based Costing Methodology`  [INFERRED]
  lib/zbc/calculate.ts → README.md
- `POST()` --calls--> `geocode()`  [EXTRACTED]
  app/api/calculate/route.ts → lib/providers/geocode.ts
- `POST()` --calls--> `getDieselPrice()`  [EXTRACTED]
  app/api/calculate/route.ts → lib/providers/fuel.ts

## Hyperedges (group relationships)
- **ZBC Cost Calculation Pipeline (providers -> calculateZBC -> validate -> response)** — lib_providers_geocode, lib_providers_fuel, lib_providers_routing, lib_providers_tolls, lib_zbc_calculate, lib_zbc_validate, api_calculate_route [EXTRACTED 0.95]
- **Cost Breakdown Display (BreakdownChart + CostBreakdownTable + ContributionBadge + ProvenanceBadge)** — component_breakdown_chart, component_cost_breakdown_table, component_contribution_badge, component_provenance_badge [INFERRED 0.85]
- **ZBC Data Provenance System (lib_zbc_provenance + DataSourcesPanel + ProvenanceBadge + buildCostHeadProvenance)** — lib_zbc_provenance, component_data_sources_panel, component_provenance_badge, lib_zbc_cost_head_provenance [INFERRED 0.90]
- **Three-tier Provider Fallback Chain (API -> Config -> Estimate)** — providers_routing_routeGoogle, providers_routing_routeORS, utils_haversine_haversineKm [EXTRACTED 0.95]
- **ZBC Core Calculation Flow (providers feed calculateZBC)** — providers_fuel_getDieselPrice, providers_routing_getRouteDistance, providers_tolls_getTollEstimate, zbc_calculate_calculateZBC [INFERRED 0.85]
- **Config Files + lib/config.ts Gateway Pattern** — fallback_rates_json, truck_rates_json, lib_config_getFallbackRates, lib_config_getTruckRatesConfig [EXTRACTED 0.95]

## Communities (45 total, 24 thin omitted)

### Community 0 - "Calculate API & Validation"
Cohesion: 0.06
Nodes (52): bodySchema, overridesSchema, POST(), warnIfNotApi(), ContributionBadge(), labels, styles, CalculateRequest (+44 more)

### Community 1 - "Toll Rate Corridors"
Cohesion: 0.06
Nodes (32): corridor_tolls, delhi_mumbai, from_aliases, highway, plazas, to_aliases, toll_by_class, diesel_by_state (+24 more)

### Community 2 - "Cost Head Contribution Benchmarks"
Cohesion: 0.06
Nodes (31): contribution_ranges, driver, empty_return, fuel, idle, loading, maintenance, overhead (+23 more)

### Community 3 - "Project Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, @headlessui/react, next, react, react-dom, recharts, zod, devDependencies (+21 more)

### Community 4 - "Frontend UI & Response Types"
Cohesion: 0.19
Nodes (16): CalculateResponse, formatInr(), HomePage(), BreakdownChart(), ChartRow, BreakdownRow, CostBreakdownTable(), DataSourcesPanel() (+8 more)

### Community 5 - "Truck Rate Profile A"
Cohesion: 0.08
Nodes (23): bata_per_trip, driver_per_day, empty_return_pct, idle_cost_per_hour, idle_hours_by_distance, label, loading_per_ton, loading_per_trip (+15 more)

### Community 6 - "API Routes & Pages"
Cohesion: 0.14
Nodes (23): Calculate API Route, Cities API Route, Home Page (ZBC Calculator), BreakdownChart Component, ContributionBadge Component, CostBreakdownTable Component, DataSourcesPanel Component, ProvenanceBadge Component (+15 more)

### Community 7 - "Truck Rate Profile B"
Cohesion: 0.10
Nodes (21): bata_per_trip, driver_per_day, empty_return_pct, idle_cost_per_hour, idle_hours_by_distance, label, loading_per_ton, loading_per_trip (+13 more)

### Community 8 - "Truck Rate Profile C"
Cohesion: 0.10
Nodes (21): bata_per_trip, driver_per_day, empty_return_pct, idle_cost_per_hour, idle_hours_by_distance, label, loading_per_ton, loading_per_trip (+13 more)

### Community 9 - "Truck Rate Profile D"
Cohesion: 0.10
Nodes (21): bata_per_trip, driver_per_day, empty_return_pct, idle_cost_per_hour, idle_hours_by_distance, label, loading_per_ton, loading_per_trip (+13 more)

### Community 10 - "Geocoding & City Lookup"
Cohesion: 0.15
Nodes (17): GET(), OpenStreetMap Nominatim Geocoder, getCitiesCache(), getCitiesCache(), geocode(), geocodeFromCache(), geocodeNominatim(), geocodeFromCache() (+9 more)

### Community 11 - "TypeScript Build Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 12 - "External API Providers"
Cohesion: 0.14
Nodes (17): The Core India Fuel Watch API, Google Distance Matrix API, OpenRouteService Routing API, Fallback Rates Config, getFallbackRates(), getDieselPrice(), loadCoreFuelPrices(), lookupDieselInMap() (+9 more)

### Community 13 - "Fuel Price Provider"
Cohesion: 0.21
Nodes (13): buildStateMap(), CoreFuelResponse, CoreStateEntry, FuelPriceResult, getDieselPrice(), isValidDieselPrice(), loadCoreFuelPrices(), lookupDieselInMap() (+5 more)

### Community 14 - "Truck Config & Documentation"
Cohesion: 0.18
Nodes (11): Config README, getTruckProfile(), getTruckRatesConfig(), Zero Based Costing README, Zero-Based Costing Methodology, Truck Rates Config, calculateZBC(), ZBC Calculate Tests (+3 more)

### Community 15 - "ESLint Linting Config"
Cohesion: 0.40
Nodes (4): compat, __dirname, eslintConfig, __filename

### Community 16 - "Data Provenance System"
Cohesion: 0.40
Nodes (5): Provenance Tracking Rationale, buildCostHeadProvenance(), Provenance Interface, CostHeadId Type, RateOverrides Interface

## Knowledge Gaps
- **235 isolated node(s):** `__filename`, `__dirname`, `compat`, `eslintConfig`, `nextConfig` (+230 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `trucks` connect `Truck Rate Profile A` to `Truck Rate Profile C`, `Truck Rate Profile D`, `Truck Rate Profile B`?**
  _High betweenness centrality (0.238) - this node is a cross-community bridge._
- **Why does `geocode()` connect `Geocoding & City Lookup` to `Calculate API & Validation`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Why does `suggestCities()` connect `Geocoding & City Lookup` to `External API Providers`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **What connects `__filename`, `__dirname`, `compat` to the rest of the system?**
  _242 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Calculate API & Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `Toll Rate Corridors` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `Cost Head Contribution Benchmarks` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._