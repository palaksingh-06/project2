"use client";

import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getTruckModels, getTruckOptions } from "@/lib/config";
import type { RateOverrides } from "@/lib/zbc/types";

export interface CalculateRequest {
  truckId: string;
  modelId?: string;
  origin: string;
  destination: string;
  payloadTons: number;
  overrides?: RateOverrides;
}

interface TripFormProps {
  onSubmit: (data: CalculateRequest) => void;
  loading: boolean;
  truckRates?: Record<
    string,
    {
      label: string;
      payload_tons: number;
      mileage_kmpl: number;
      driver_per_day: number;
      bata_per_trip: number;
      night_halt_per_night: number;
      depreciation_per_km: number;
      maintenance_per_km: number;
      loading_per_ton: number;
      idle_hours_short_haul: number;
      idle_hours_medium_haul: number;
      idle_hours_long_haul: number;
      idle_cost_per_hour: number;
      overhead_per_trip: number;
      risk_pct: number;
      empty_return_pct: number;
    }
  >;
}

function CityInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<
    { name: string; label: string }[]
  >([]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`);
    const data = (await res.json()) as {
      cities: { name: string; label: string }[];
    };
    setSuggestions(data.cities);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchSuggestions(query), 200);
    return () => clearTimeout(t);
  }, [query, fetchSuggestions]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        type="text"
        list={`${label}-list`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
        }}
        placeholder="e.g. Delhi"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <datalist id={`${label}-list`}>
        {suggestions.map((s) => (
          <option key={s.label} value={s.name} />
        ))}
      </datalist>
    </div>
  );
}

export function TripForm({ onSubmit, loading, truckRates }: TripFormProps) {
  const truckOptions = useMemo(() => getTruckOptions(), []);
  const allModels = useMemo(() => getTruckModels(), []);
  const [truckQuery, setTruckQuery] = useState("");
  const [selectedTruck, setSelectedTruck] = useState(truckOptions[1] ?? truckOptions[0]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [origin, setOrigin] = useState("Delhi");
  const [destination, setDestination] = useState("Mumbai");
  const [payloadTons, setPayloadTons] = useState(16);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overrides, setOverrides] = useState<RateOverrides>({});

  const modelOptions = useMemo(() => {
    if (!selectedTruck) return [];
    return Object.entries(allModels)
      .filter(([, m]) => m.truck_class === selectedTruck.id)
      .map(([id, m]) => ({ id, label: m.label, mileage_kmpl: m.mileage_kmpl }));
  }, [selectedTruck, allModels]);

  const filteredTrucks = useMemo(() => {
    const q = truckQuery.toLowerCase();
    if (!q) return truckOptions;
    return truckOptions.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
    );
  }, [truckQuery, truckOptions]);

  useEffect(() => {
    if (selectedTruck && truckRates?.[selectedTruck.id]) {
      setPayloadTons(truckRates[selectedTruck.id].payload_tons);
    }
    setSelectedModelId("");
  }, [selectedTruck, truckRates]);

  const profile = selectedTruck ? truckRates?.[selectedTruck.id] : null;

  const resetOverrides = () => setOverrides({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTruck) return;
    onSubmit({
      truckId: selectedTruck.id,
      modelId: selectedModelId || undefined,
      origin,
      destination,
      payloadTons,
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
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Truck type
        </label>
        <Combobox
          value={selectedTruck}
          onChange={(v) => v && setSelectedTruck(v)}
        >
          <div className="relative">
            <ComboboxInput
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              displayValue={(t: { label: string } | null) => t?.label ?? ""}
              onChange={(e) => setTruckQuery(e.target.value)}
              placeholder="Search truck type…"
            />
            <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
              <span className="text-slate-400">▾</span>
            </ComboboxButton>
            <ComboboxOptions className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {filteredTrucks.map((t) => (
                <ComboboxOption
                  key={t.id}
                  value={t}
                  className="cursor-pointer px-3 py-2 text-sm data-[focus]:bg-brand-50"
                >
                  {t.label}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          </div>
        </Combobox>
      </div>

      {modelOptions.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Truck model <span className="font-normal text-slate-400">(optional — uses ARAI mileage)</span>
          </label>
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Generic / Unknown (use class default)</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.mileage_kmpl} km/l
              </option>
            ))}
          </select>
        </div>
      )}

      <CityInput label="Origin" value={origin} onChange={setOrigin} />
      <CityInput label="Destination" value={destination} onChange={setDestination} />

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Payload (tons)
        </label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={payloadTons}
          onChange={(e) => setPayloadTons(parseFloat(e.target.value) || 0)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
            <button
              type="button"
              onClick={resetOverrides}
              className="text-xs text-brand-600 hover:underline"
            >
              Reset to defaults
            </button>
          </div>

          <p className="text-xs text-slate-500">Fuel</p>
          <OverrideField label="Mileage (km/l)" defaultVal={profile.mileage_kmpl} fieldKey="mileage_kmpl" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Driver & Crew</p>
          <OverrideField label="Driver ₹/day" defaultVal={profile.driver_per_day} fieldKey="driver_per_day" setOverride={setOverride} />
          <OverrideField label="Bata allowance ₹/trip" defaultVal={profile.bata_per_trip} fieldKey="bata_per_trip" setOverride={setOverride} />
          <OverrideField label="Night halt ₹/night" defaultVal={profile.night_halt_per_night} fieldKey="night_halt_per_night" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Vehicle depreciation</p>
          <OverrideField label="Depreciation ₹/km (owned fleet)" defaultVal={profile.depreciation_per_km} fieldKey="depreciation_per_km" setOverride={setOverride} />
          <OverrideField label="Hire charge ₹/trip (hired truck — overrides ₹/km)" defaultVal={undefined} fieldKey="vehicle_per_trip" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Maintenance</p>
          <OverrideField label="Maintenance ₹/km" defaultVal={profile.maintenance_per_km} fieldKey="maintenance_per_km" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Loading & Unloading</p>
          <OverrideField label="Loading ₹/ton" defaultVal={profile.loading_per_ton} fieldKey="loading_per_ton" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Idle / Waiting</p>
          <OverrideField
            label={`Idle hours (defaults: ${profile.idle_hours_short_haul}h <300km / ${profile.idle_hours_medium_haul}h 300–800km / ${profile.idle_hours_long_haul}h >800km)`}
            defaultVal={undefined}
            fieldKey="idle_hours"
            setOverride={setOverride}
          />
          <OverrideField label="Idle cost ₹/hour" defaultVal={profile.idle_cost_per_hour} fieldKey="idle_cost_per_hour" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Overheads & Permits</p>
          <OverrideField label="Overheads ₹/trip" defaultVal={profile.overhead_per_trip} fieldKey="overhead_per_trip" setOverride={setOverride} />
          <OverrideField label="State permit ₹/trip" defaultVal={undefined} fieldKey="state_permit" setOverride={setOverride} />

          <p className="text-xs text-slate-500 pt-1">Risk & Empty Return</p>
          <OverrideField label="Risk % (0–1)" defaultVal={profile.risk_pct} fieldKey="risk_pct" setOverride={setOverride} />
          <OverrideField label="Empty return % (0–1)" defaultVal={profile.empty_return_pct} fieldKey="empty_return_pct" setOverride={setOverride} />
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !selectedTruck}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Calculating…" : "Calculate trip cost"}
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
        {defaultVal !== undefined && (
          <span className="text-slate-400"> (default {defaultVal})</span>
        )}
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
