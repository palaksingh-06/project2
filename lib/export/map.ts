import { haversineKm } from "@/lib/utils/haversine";
import type { BatchRowResult } from "@/lib/export/excel";
import outletGeotags from "@/config/outlet-geotags.json";

// ── Outlet name lookup (same logic as excel.ts) ───────────────────────────
const OUTLETS = outletGeotags.outlets as { name: string; lat: number; lng: number }[];
const OUTLET_TOL = 0.0025; // ~275 m

function outletName(lat: number, lng: number, fallback: string): string {
  let best: { name: string; dist: number } | null = null;
  for (const o of OUTLETS) {
    const d = (o.lat - lat) ** 2 + (o.lng - lng) ** 2;
    if (!best || d < best.dist) best = { name: o.name, dist: d };
  }
  return best && best.dist <= OUTLET_TOL ** 2 ? best.name : fallback;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface Stop {
  name: string;
  lat: number;
  lng: number;
  routeName: string;
}

interface RouteGroup {
  name: string;
  stops: Stop[]; // ordered by nearest-neighbour
}

// ── Nearest-neighbour TSP heuristic ───────────────────────────────────────

// Orders stops so consecutive pairs are as close as possible (greedy).
function nearestNeighbourOrder(stops: Stop[]): Stop[] {
  if (stops.length <= 1) return stops;
  const remaining = [...stops];
  const ordered = [remaining.splice(0, 1)[0]];
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let minIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
      if (d < minDist) {
        minDist = d;
        minIdx = i;
      }
    }
    ordered.push(remaining.splice(minIdx, 1)[0]);
  }
  return ordered;
}

// ── Data extraction ────────────────────────────────────────────────────────

// Collects unique stops and groups them by route from batch results.
//
// Deduplication key is coord+route (NOT just coord) so the same physical
// location (e.g. the warehouse origin) can appear in every route it belongs
// to. The nearest-neighbour is then called per-route in isolation — it only
// sees that route's own stops and can never jump to a different route.
function extractRoutes(results: BatchRowResult[]): {
  allStops: Stop[];
  routes: RouteGroup[];
} {
  // Per-route stop sets: routeName → Map<coordKey, Stop>
  const routeStopMaps = new Map<string, Map<string, Stop>>();

  // All unique coords across all routes (for placing dot markers on the map)
  const allStopMap = new Map<string, Stop>();

  for (const r of results) {
    const rn = r.routeName?.trim() ?? "";
    if (!rn) continue; // skip rows with no route — they have no polyline

    if (!routeStopMaps.has(rn)) routeStopMaps.set(rn, new Map());
    const routeMap = routeStopMaps.get(rn)!;

    const oLat = r.meta.origin.lat;
    const oLng = r.meta.origin.lng;
    const dLat = r.meta.destination.lat;
    const dLng = r.meta.destination.lng;

    if (oLat != null && oLng != null) {
      const coordKey = `${oLat.toFixed(4)},${oLng.toFixed(4)}`;
      const name = outletName(oLat, oLng, r.meta.origin.name);
      const stop: Stop = { lat: oLat, lng: oLng, name, routeName: rn };
      // Add to this route's deduplicated set (same coord on same route = one stop)
      if (!routeMap.has(coordKey)) routeMap.set(coordKey, stop);
      // Add to the global dot-marker set
      if (!allStopMap.has(coordKey)) allStopMap.set(coordKey, stop);
    }

    if (dLat != null && dLng != null) {
      const coordKey = `${dLat.toFixed(4)},${dLng.toFixed(4)}`;
      const name = outletName(dLat, dLng, r.meta.destination.name);
      const stop: Stop = { lat: dLat, lng: dLng, name, routeName: rn };
      if (!routeMap.has(coordKey)) routeMap.set(coordKey, stop);
      if (!allStopMap.has(coordKey)) allStopMap.set(coordKey, stop);
    }
  }

  const allStops = Array.from(allStopMap.values());

  // Build route groups. nearestNeighbourOrder only receives THIS route's stops,
  // so it physically cannot connect to a stop belonging to a different route.
  const routes: RouteGroup[] = [];
  for (const [name, stopMap] of routeStopMaps.entries()) {
    const stops = Array.from(stopMap.values());
    routes.push({ name, stops: nearestNeighbourOrder(stops) });
  }

  routes.sort((a, b) => a.name.localeCompare(b.name));

  return { allStops, routes };
}

// ── Colour palette for routes ──────────────────────────────────────────────

const ROUTE_COLOURS = [
  "#7c3aed", // violet-600
  "#2563eb", // blue-600
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#dc2626", // red-600
  "#0891b2", // cyan-600
  "#9333ea", // purple-600
  "#16a34a", // green-600
];

function routeColour(idx: number): string {
  return ROUTE_COLOURS[idx % ROUTE_COLOURS.length];
}

// ── HTML generator ─────────────────────────────────────────────────────────

export function generateRouteMapHtml(results: BatchRowResult[]): string {
  const { allStops, routes } = extractRoutes(results);

  if (allStops.length === 0) return "<html><body>No geocoded stops found.</body></html>";

  // Centre map on the mean of all stop coordinates
  const avgLat = allStops.reduce((s, p) => s + p.lat, 0) / allStops.length;
  const avgLng = allStops.reduce((s, p) => s + p.lng, 0) / allStops.length;

  // Build JS arrays for injection into the HTML template
  const markersJs = JSON.stringify(
    allStops.map((s) => ({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      route: s.routeName ?? "",
    })),
    null,
    2
  );

  const routesJs = JSON.stringify(
    routes.map((r, i) => ({
      name: r.name,
      colour: routeColour(i),
      stops: r.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng })),
    })),
    null,
    2
  );

  // Unique route names for the dropdown
  const routeNames = routes.map((r) => r.name);
  const clusterOptionsHtml = routeNames
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("\n        ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Route Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; height: 100vh; display: flex; flex-direction: column; }

    /* ── Top bar ── */
    #topbar {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 10px 16px; background: #1e293b; border-bottom: 1px solid #334155; z-index: 1000;
    }
    #topbar h1 { font-size: 15px; font-weight: 600; color: #e2e8f0; margin-right: auto; }

    /* ── Controls ── */
    select, label {
      font-size: 13px; color: #cbd5e1;
    }
    select {
      background: #0f172a; border: 1px solid #475569; border-radius: 6px;
      padding: 5px 10px; cursor: pointer; color: #e2e8f0;
    }
    select:focus { outline: none; border-color: #7c3aed; }

    .toggle-label {
      display: flex; align-items: center; gap: 6px; cursor: pointer;
      user-select: none; font-size: 13px; color: #cbd5e1;
    }
    .toggle-label input[type=checkbox] { width: 15px; height: 15px; accent-color: #7c3aed; }

    /* ── Badge ── */
    #badge {
      background: #7c3aed; color: #fff; border-radius: 20px;
      padding: 3px 10px; font-size: 12px; font-weight: 600; white-space: nowrap;
    }

    /* ── Map ── */
    #map { flex: 1; }

    /* ── Route name badge on polyline midpoint ── */
    .route-label-badge {
      display: inline-block;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.25);
    }

    /* ── Name label tooltip style ── */
    .leaflet-tooltip.name-label {
      background: rgba(15,23,42,0.85);
      border: 1px solid #475569;
      border-radius: 6px;
      color: #f1f5f9;
      font-size: 11px;
      padding: 2px 7px;
      white-space: nowrap;
      box-shadow: none;
    }
    .leaflet-tooltip.name-label::before { display: none; }
  </style>
</head>
<body>
  <div id="topbar">
    <h1>Route Map</h1>

    <!-- Route filter dropdown (multiselect) -->
    <select id="routeSelect" multiple size="4" title="Hold Ctrl/Cmd to select multiple routes">
      <option value="ALL" selected>All routes</option>
      ${clusterOptionsHtml}
    </select>

    <!-- Show names toggle -->
    <label class="toggle-label">
      <input type="checkbox" id="showNames" />
      Show names
    </label>

    <span id="badge">0 stops</span>
  </div>

  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    // ── Data injected by generator ──────────────────────────────────────────
    const MARKERS = ${markersJs};
    const ROUTES  = ${routesJs};

    // ── Map init ────────────────────────────────────────────────────────────
    const map = L.map('map', { zoomControl: true }).setView([${avgLat.toFixed(5)}, ${avgLng.toFixed(5)}], 7);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map);

    // ── Haversine (inline, no import needed in HTML) ─────────────────────
    function haversineKm(lat1, lng1, lat2, lng2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 +
                Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
                Math.sin(dLng/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // ── State ───────────────────────────────────────────────────────────────
    const activeRoutes = new Set(); // route names currently shown
    let leafletMarkers = [];        // { stop, lMarker, tooltip } per visible stop
    let showNames = false;

    // ── Route polyline + midpoint label (one per route, hidden by default) ──
    const routeLayers = {}; // routeName → { poly, labelMarker }

    ROUTES.forEach(function(route) {
      const latlngs = route.stops.map(function(s) { return [s.lat, s.lng]; });
      const poly = L.polyline(latlngs, {
        color: route.colour,
        weight: 4,
        opacity: 0,
        interactive: true,
      }).addTo(map);

      // Midpoint label marker
      const midIdx = Math.floor((latlngs.length - 1) / 2);
      const midPt = latlngs[midIdx] || latlngs[0];
      const labelMarker = L.marker(midPt, {
        icon: L.divIcon({
          className: '',
          html: '<div class="route-label-badge" style="background:' + route.colour + '">' + route.name + '</div>',
          iconAnchor: [0, 10],
        }),
        interactive: false,
        zIndexOffset: 1000,
      }); // not added to map until route is shown

      // When polyline is clicked show segment distances
      poly.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        const stops = route.stops;
        let html = '<div style="font-size:12px;line-height:1.6">';
        html += '<b>' + route.name + '</b><br/>';
        for (let i = 0; i < stops.length - 1; i++) {
          const d = haversineKm(stops[i].lat, stops[i].lng, stops[i+1].lat, stops[i+1].lng);
          html += stops[i].name + ' → ' + stops[i+1].name + ': <b>' + d.toFixed(1) + ' km</b><br/>';
        }
        html += '</div>';
        L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
      });

      routeLayers[route.name] = { poly, labelMarker };
    });

    // ── Show/hide a route polyline (toggle) ──────────────────────────────────
    function showRoute(routeName) {
      const layer = routeLayers[routeName];
      if (!layer) return;
      if (activeRoutes.has(routeName)) {
        layer.poly.setStyle({ opacity: 0 });
        map.removeLayer(layer.labelMarker);
        activeRoutes.delete(routeName);
      } else {
        layer.poly.setStyle({ opacity: 0.85 });
        layer.labelMarker.addTo(map);
        activeRoutes.add(routeName);
      }
    }

    function hideAllRoutes() {
      activeRoutes.forEach(function(rn) {
        const layer = routeLayers[rn];
        if (layer) {
          layer.poly.setStyle({ opacity: 0 });
          map.removeLayer(layer.labelMarker);
        }
      });
      activeRoutes.clear();
    }

    // ── Dot icon factory ─────────────────────────────────────────────────────
    function dotIcon(colour) {
      return L.divIcon({
        className: '',
        html: '<div style="width:12px;height:12px;border-radius:50%;background:' + colour +
              ';border:2px solid #fff;box-shadow:0 0 6px ' + colour + ';"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
    }

    // ── Refresh markers based on (multi)select filter ────────────────────────
    function refreshMarkers() {
      const sel = document.getElementById('routeSelect');
      const selected = Array.from(sel.selectedOptions).map(function(o) { return o.value; });
      const showAll = selected.length === 0 || selected.includes('ALL');

      // Remove existing markers and tooltips
      leafletMarkers.forEach(function(m) {
        map.removeLayer(m.lMarker);
      });
      leafletMarkers = [];

      // Find route colour for each stop
      const routeColourMap = {};
      ROUTES.forEach(function(r) { routeColourMap[r.name] = r.colour; });

      const visible = MARKERS.filter(function(s) {
        return showAll || selected.includes(s.route);
      });

      visible.forEach(function(stop) {
        const colour = routeColourMap[stop.route] || '#94a3b8';
        const lm = L.marker([stop.lat, stop.lng], { icon: dotIcon(colour) }).addTo(map);

        // On click: toggle that stop's route line (static, instant)
        lm.on('click', function(e) {
          L.DomEvent.stopPropagation(e);
          if (stop.route) showRoute(stop.route);
        });

        let tooltip = null;
        if (showNames) {
          tooltip = L.tooltip({
            permanent: true,
            direction: 'right',
            offset: [10, 0],
            className: 'name-label',
          }).setContent(stop.name);
          lm.bindTooltip(tooltip).openTooltip();
        }

        leafletMarkers.push({ stop, lMarker: lm, tooltip });
      });

      document.getElementById('badge').textContent = visible.length + ' stop' + (visible.length !== 1 ? 's' : '');
    }

    // ── Hide all route lines when clicking the map background ───────────────
    map.on('click', function() {
      hideAllRoutes();
    });

    // ── Control wiring ───────────────────────────────────────────────────────
    document.getElementById('routeSelect').addEventListener('change', function() {
      hideAllRoutes(); // reset shown lines when filter changes
      refreshMarkers();
    });

    document.getElementById('showNames').addEventListener('change', function(e) {
      showNames = e.target.checked;
      refreshMarkers();
    });

    // ── Initial render ───────────────────────────────────────────────────────
    refreshMarkers();
  </script>
</body>
</html>`;
}
