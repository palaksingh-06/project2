"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getTruckModels, getTrucksByBodyType, getTruckProfile } from "@/lib/config";
import type { RateOverrides, CostHeadId } from "@/lib/zbc/types";

export interface CalculateRequest {
  truckId: string;
  modelId?: string;
  routes: string[];
  tripType: string;
  payloadTons: number;
  overrides?: RateOverrides;
  /** Cost head IDs to fully omit from this calculation (Configuration tab toggles). */
  excluded_heads?: CostHeadId[];
}

interface TripFormProps {
  onSubmit: (data: CalculateRequest) => void;
  loading: boolean;
  truckRates?: Record<string, unknown>;
}

function CityInput({
  label,
  value,
  onChange,
  showLabel = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  showLabel?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<{ name: string; label: string }[]>([]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`);
    const data = (await res.json()) as { cities: { name: string; label: string }[] };
    setSuggestions(data.cities);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchSuggestions(query), 200);
    return () => clearTimeout(t);
  }, [query, fetchSuggestions]);

  return (
    <div>
      {showLabel && <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>}
      <input
        type="text"
        list={`${label}-list`}
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); }}
        placeholder="e.g. Delhi"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <datalist id={`${label}-list`}>
        {suggestions.map((s) => <option key={s.label} value={s.name} />)}
      </datalist>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50";

const MAX_STOPS = 10;

export function TripForm({ onSubmit, loading }: TripFormProps) {
  const allModels = useMemo(() => getTruckModels(), []);

  const [bodyType, setBodyType] = useState<"open" | "closed">("open");
  const [selectedTons, setSelectedTons] = useState<number | null>(null);
  const [selectedFeet, setSelectedFeet] = useState<number | null>(null);
  const [selectedAxles, setSelectedAxles] = useState<number | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [origin, setOrigin] = useState("");
  const [stops, setStops] = useState<string[]>([""]);

  const addStop = () => {
    if (stops.length < MAX_STOPS) setStops((s) => [...s, ""]);
  };
  const removeStop = (i: number) => {
    setStops((s) => s.filter((_, idx) => idx !== i));
  };
  const updateStop = (i: number, v: string) => {
    setStops((s) => { const n = [...s]; n[i] = v; return n; });
  };
  const [tripType, setTripType] = useState("one-way");
  const [payloadTons, setPayloadTons] = useState("0");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overrides, setOverrides] = useState<RateOverrides>({});

  // All trucks for the selected body type
  const bodyTypeTrucks = useMemo(() => getTrucksByBodyType(bodyType), [bodyType]);

  // Cascading filter levels
  const availableTons = useMemo(
    () => [...new Set(bodyTypeTrucks.map((t) => t.payload_tons))].sort((a, b) => a - b),
    [bodyTypeTrucks]
  );

  const trucksAfterTons = useMemo(
    () => selectedTons != null ? bodyTypeTrucks.filter((t) => t.payload_tons === selectedTons) : bodyTypeTrucks,
    [bodyTypeTrucks, selectedTons]
  );

  const availableFeet = useMemo(
    () => [...new Set(trucksAfterTons.map((t) => t.length_ft))].sort((a, b) => a - b),
    [trucksAfterTons]
  );

  const trucksAfterFeet = useMemo(
    () => selectedFeet != null ? trucksAfterTons.filter((t) => t.length_ft === selectedFeet) : trucksAfterTons,
    [trucksAfterTons, selectedFeet]
  );

  const availableAxles = useMemo(
    () => [...new Set(trucksAfterFeet.map((t) => t.axles))].sort((a, b) => a - b),
    [trucksAfterFeet]
  );

  const matchedTruck = useMemo(
    () =>
      selectedTons != null && selectedFeet != null && selectedAxles != null
        ? (trucksAfterFeet.find((t) => t.axles === selectedAxles) ?? null)
        : null,
    [trucksAfterFeet, selectedTons, selectedFeet, selectedAxles]
  );

  // Reset downstream selections on body type change
  useEffect(() => {
    setSelectedTons(null);
    setSelectedFeet(null);
    setSelectedAxles(null);
    setSelectedModelId("");
  }, [bodyType]);

  // Reset feet + axles when tons changes
  useEffect(() => {
    setSelectedFeet(null);
    setSelectedAxles(null);
  }, [selectedTons]);

  // Reset axles when feet changes
  useEffect(() => {
    setSelectedAxles(null);
  }, [selectedFeet]);

  // Update payload when a truck is matched
  useEffect(() => {
    if (matchedTruck) {
      const p = getTruckProfile(matchedTruck.id);
      if (p) setPayloadTons(p.payload_tons.toString());
      setSelectedModelId("");
    }
  }, [matchedTruck]);

  const profile = matchedTruck ? getTruckProfile(matchedTruck.id) : null;

  const modelOptions = useMemo(() => {
    if (!matchedTruck) return [];
    return Object.entries(allModels)
      .filter(([, m]) => m.truck_class === matchedTruck.id)
      .map(([id, m]) => ({ id, label: m.label, mileage_kmpl: m.mileage_kmpl.value, image: m.image }));
  }, [matchedTruck, allModels]);

  const resetOverrides = () => setOverrides({});

  const [markPayloadInvalid, setMarkPayloadInvalid] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!matchedTruck) return; // Just caution

    if((selectedTons != null && Number(payloadTons) > selectedTons)) {
      setMarkPayloadInvalid(true);
      return;
    }

    onSubmit({
      truckId: matchedTruck?.id ?? "", // placeholder catch
      modelId: selectedModelId || undefined,
      routes: [origin, ...stops],
      tripType,
      payloadTons: Math.round(Number(payloadTons) * 10) / 10, // Rounds to 1 decimal place
      overrides: Object.keys(overrides).length ? overrides : undefined,
    });
  };

  const setOverride = (key: keyof RateOverrides, value: string) => {
    setOverrides((o) => {
      const next = { ...o };
      if (value === "") delete next[key];
      else (next as Record<string, number>)[key] = parseFloat(value);
      return next;
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Body type toggle */}
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Body type</label>
        <div className="flex gap-2">
          {(["open", "closed"] as const).map((bt) => (
            <button
              key={bt}
              type="button"
              onClick={() => setBodyType(bt)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                bodyType === bt
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {bt === "open" ? "Open Body" : "Closed Body"}
            </button>
          ))}
        </div>
      </div>

      {/* Cascading truck spec selectors */}
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Truck specs</label>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Capacity</label>
            <select
              value={selectedTons ?? ""}
              onChange={(e) => setSelectedTons(e.target.value ? Number(e.target.value) : 0)}
              className={inputCls}
            >
              <option value="">None</option>
              {availableTons.map((t) => (
                <option key={t} value={t}>{t} T</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Length</label>
            <select
              value={selectedFeet ?? ""}
              onChange={(e) => setSelectedFeet(e.target.value ? Number(e.target.value) : null)}
              disabled={selectedTons == null}
              className={inputCls}
            >
              <option value="">None</option>
              {availableFeet.map((f) => (
                <option key={f} value={f}>{f} ft</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Axles</label>
            <select
              value={selectedAxles ?? ""}
              onChange={(e) => setSelectedAxles(e.target.value ? Number(e.target.value) : null)}
              disabled={selectedFeet == null}
              className={inputCls}
            >
              <option value="">None</option>
              {availableAxles.map((a) => (
                <option key={a} value={a}>{a}-Axle</option>
              ))}
            </select>
          </div>
        </div>

        {/* Matched truck label */}
        {matchedTruck ? (
          <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
            {matchedTruck.label}
          </div>
        ) : (selectedTons != null || selectedFeet != null) && (
          <p className="mt-1 text-xs text-slate-400">Select all three to identify truck</p>
        )}
      </div>

      {/* Optional model selector */}
      {modelOptions.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Truck model <span className="font-normal text-slate-400">(optional — uses ARAI mileage)</span>
          </label>
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className={inputCls}
          >
            <option value="">Generic / Unknown (use class default)</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {Math.round(m.mileage_kmpl * 0.7 * 10) / 10} km/l
              </option>
            ))}
          </select>
          {selectedModelId && (() => {
            const selected = modelOptions.find((m) => m.id === selectedModelId);
            return selected?.image ? (
              <img
                src={selected.image}
                alt={selected.label}
                className="mt-2 h-24 w-auto rounded-lg border border-slate-200 object-contain bg-white p-1"
              />
            ) : null;
          })()}
        </div>
      )}

      <CityInput label="Origin" value={origin} onChange={setOrigin} />

      {stops.length !== 1 && <label className="mb-1 block text-sm font-medium text-slate-700">Stops</label>}
      {stops.map((stop, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <CityInput
              label={stops.length === 1 ? "Destination" : `Stop ${i + 1}`} // To keep unique data lists
              value={stop}
              showLabel={stops.length === 1}
              onChange={(v) => updateStop(i, v)}
            />
          </div>
          {stops.length > 1 && (
            <button
              type="button"
              onClick={() => removeStop(i)}
              title="Remove stop"
              className="mb-0.5 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
            >
              ×
            </button>
          )}
        </div>
      ))}

      <button
          type="button"
          onClick={addStop}
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
          disabled={stops.length >= MAX_STOPS}
        >
          + Add stop
      </button>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Trip type</label>
        <div className="flex gap-2">
          {[{ value: "one-way", label: "One Way" }, { value: "two-way", label: "Two Way" }].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTripType(value)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                tripType === value
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            > {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Payload (T)&nbsp;
          {
            (() => {
              if(markPayloadInvalid)
                return (<span className="text-xs text-red-500 py-1 italic"> - Invalid payload. Must be within truck&apos;s capacity!</span>);
            })()
          }
        </label>
        
        <input
          type="number"
          value={payloadTons}
          onChange={(e) => {
            setMarkPayloadInvalid(false);// reset marker

            if(e.target.value === "") {
              setPayloadTons("");
              return;
            }

            setPayloadTons(Math.max(0.1, Number(e.target.value)).toString());
          }}
          onBlur={() => {
            if(payloadTons === "") {
              setPayloadTons("0.1"); // Make sure user does not leave an empty field
              return;
            }
          }}
          className={inputCls}
          disabled={selectedTons == null}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        {showAdvanced ? "Hide" : "Show"} advanced rates
      </button>

      {showAdvanced && profile && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex justify-between">
            <span className="text-sm font-medium text-slate-700">Override defaults</span>
            <button type="button" onClick={resetOverrides} className="text-xs text-brand-600 hover:underline">
              Reset to defaults
            </button>
          </div>

          <p className="text-xs text-slate-500">Route</p>
          <OverrideField
            label="Distance override (km) — replaces geocoded/routed distance"
            defaultVal={undefined}
            fieldKey="distance_km"
            setOverride={setOverride}
          />

          <p className="text-xs text-slate-500 pt-1">Fuel</p>
          <OverrideField label="Effective mileage (km/l)" defaultVal={profile.mileage_kmpl_considered} fieldKey="mileage_kmpl" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Driver & Crew</p>
          <OverrideField label="Driver ₹/day" defaultVal={profile.driver_per_day} fieldKey="driver_per_day" setOverride={setOverride} />
          <OverrideField label="Bata allowance ₹/trip" defaultVal={profile.bata_per_trip} fieldKey="bata_per_trip" setOverride={setOverride} />
          <OverrideField label="Night halt ₹/night" defaultVal={profile.night_halt_per_night} fieldKey="night_halt_per_night" setOverride={setOverride} />
          <OverrideField label="Helper ₹/day (off by default)" defaultVal={profile.helper_per_day} fieldKey="helper_per_day" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Depreciation (Vehicle)</p>
          <OverrideField label="Ex-showroom price (₹)" defaultVal={profile.ex_showroom_inr} fieldKey="ex_showroom_inr" setOverride={setOverride} />
          <OverrideField label="Salvage value (0–1)" defaultVal={profile.salvage_pct} fieldKey="salvage_pct" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Maintenance</p>
          <OverrideField label="Maintenance ₹/km" defaultVal={profile.maintenance_per_km} fieldKey="maintenance_per_km" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Loading & Unloading</p>
          <OverrideField label="Loading ₹/ton" defaultVal={profile.loading_per_ton} fieldKey="loading_per_ton" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Overhead & Profit</p>
          <OverrideField label="Overhead % (0–1)" defaultVal={0.07} fieldKey="overhead_pct" setOverride={setOverride} />
          <OverrideField label="Profit % (0–1)" defaultVal={0.10} fieldKey="profit_pct" setOverride={setOverride} />
          <OverrideField label="State permit ₹/trip" defaultVal={undefined} fieldKey="state_permit" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Empty Return</p>
          <OverrideField label="Empty return % (0–1)" defaultVal={profile.empty_return_pct} fieldKey="empty_return_pct" setOverride={setOverride} />
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !matchedTruck}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Calculating…" : !matchedTruck ? "Select truck specs" : "Calculate trip cost"}
      </button>
    </form>
  );
}

function OverrideField({
  label,
  defaultVal,
  fieldKey,
  setOverride,
}: {
  label: string;
  defaultVal: number | undefined;
  fieldKey: keyof RateOverrides;
  setOverride: (key: keyof RateOverrides, value: string) => void;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-xs text-slate-600">
        {label}
        {defaultVal !== undefined && <span className="text-slate-400"> (default {defaultVal})</span>}
      </label>
      <input
        type="number"
        step="any"
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        onChange={(e) => setOverride(fieldKey, e.target.value)}
      />
    </div>
  );
}
