"use client";

// ConfigurationTab: shows every fixed/variable cost input for the selected
// truck (pre-filled from the category profile, or the selected model's
// sourced figures where available), lets the user include/exclude cost
// heads and edit values, and exposes a read-only truck-data reference
// table "like the Excel master tables" per the PRD.
//
// This component holds no calculation logic of its own — every change
// assembles the FULL next overrides/excludedHeads state and hands it to
// the parent via onChange.

import React, { useState } from "react";
import { getTruckModel, getTruckProfile } from "@/lib/config";
import { deriveDependentCosts } from "@/lib/zbc/truck-economics";
import type { RateOverrides, CostHeadId } from "@/lib/zbc/types";
import { CostSourceBadge, type CostSource } from "@/components/CostSourceBadge";

export interface ConfigurationTabProps {
  truckId: string;
  modelId: string | undefined;
  overrides: RateOverrides;
  excludedHeads: CostHeadId[];
  onChange: (overrides: RateOverrides, excludedHeads: CostHeadId[]) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

const checkboxCls = "h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500";

export function ConfigurationTab({
  truckId,
  modelId,
  overrides,
  excludedHeads,
  onChange,
}: ConfigurationTabProps) {
  const [showAddMore, setShowAddMore] = useState(false);

  const profile = getTruckProfile(truckId);
  const model = modelId ? getTruckModel(modelId) : null;

  if (!profile) return null;

  // Pre-fill mileage/price/insurance/interest exactly the way
  // lib/zbc/run-calculation.ts's model-resolution block does: mileage is
  // discounted by the same 0.7 factor, and insurance/interest are derived
  // from the model's ex-showroom price when a model is selected.
  const modelDerived = model ? deriveDependentCosts(model.ex_showroom_inr.value) : null;

  // Resolves the value shown/edited for a field: explicit override wins,
  // else the model-derived figure (for the handful of fields a model
  // affects), else the category profile default.
  function resolve(key: keyof RateOverrides, fallback: number): number {
    if (overrides[key] !== undefined) return overrides[key] as number;
    return fallback;
  }

  const driverPerDay = resolve("driver_per_day", profile.driver_per_day);
  const maintenancePerKm = resolve("maintenance_per_km", profile.maintenance_per_km);
  const tyresCount = resolve("tyres_count", profile.tyres.count);
  const tyresCostPerTyre = resolve("tyres_cost_per_tyre", profile.tyres.cost_per_tyre);
  const tyresLifeKm = resolve("tyres_life_km", profile.tyres.life_km);
  const exShowroomInr = resolve(
    "ex_showroom_inr",
    model ? model.ex_showroom_inr.value : profile.ex_showroom_inr
  );
  const salvagePct = resolve("salvage_pct", profile.salvage_pct);
  const lifeYears = resolve("life_years", profile.life_years);
  const lifeKm = resolve("life_km", profile.life_km);
  const depreciationAgingShare = resolve("depreciation_aging_share", profile.depreciation_aging_share);
  const depreciationUsageShare = resolve("depreciation_usage_share", profile.depreciation_usage_share);
  const insurancePerYear = resolve(
    "insurance_per_year",
    modelDerived ? modelDerived.insurance_per_year : profile.insurance_per_year
  );
  const roadTaxPerYear = resolve("road_tax_per_year", profile.road_tax_per_year);
  const fitnessPerYear = resolve("fitness_per_year", profile.fitness_per_year);
  const interestPerYear = resolve(
    "interest_per_year",
    modelDerived ? modelDerived.interest_per_year : profile.interest_per_year
  );

  const helperPerDay = resolve("helper_per_day", profile.helper_per_day ?? 0);
  const gpsPerYear = resolve("gps_per_year", profile.gps_per_year ?? 0);
  const fastagFeePerYear = resolve("fastag_fee_per_year", profile.fastag_fee_per_year ?? 0);
  const rtoMiscPerYear = resolve("rto_misc_per_year", profile.rto_misc_per_year ?? 0);
  const tarpaulinPerYear = resolve("tarpaulin_per_year", profile.tarpaulin_per_year ?? 0);
  const otherFixedPerYear = resolve("other_fixed_per_year", profile.other_fixed_per_year ?? 0);

  // No destination is available to this component (see prop signature), so
  // return-load probability pre-fills from the truck profile's category
  // default rather than a per-destination lookupReturnLoad() call.
  const emptyReturnPct = resolve("empty_return_pct", profile.empty_return_pct);

  function setOverride(key: keyof RateOverrides, value: string) {
    const next: RateOverrides = { ...overrides };
    if (value === "") delete next[key];
    else (next as Record<string, number>)[key] = parseFloat(value);
    onChange(next, excludedHeads);
  }

  function toggleHead(head: CostHeadId, included: boolean) {
    const next = included
      ? excludedHeads.filter((h) => h !== head)
      : [...excludedHeads, head];
    onChange(overrides, next);
  }

  const isIncluded = (head: CostHeadId) => !excludedHeads.includes(head);

  // Model source badge shown only for the two fields a selected model
  // supplies a sourced figure for — category defaults don't carry a
  // real/proxy/estimate label.
  const priceSource: CostSource | null = model ? model.ex_showroom_inr.source : null;

  return (
    <div className="space-y-5">
      {/* ── Section 1: on-by-default fields ─────────────────────────── */}
      <div className="space-y-3">
        <FieldRow
          label="Driver salary (₹/day)"
          value={driverPerDay}
          onChange={(v) => setOverride("driver_per_day", v)}
          head="driver"
          isIncluded={isIncluded}
          onToggle={toggleHead}
        />

        <FieldRow
          label="Maintenance (₹/km)"
          value={maintenancePerKm}
          onChange={(v) => setOverride("maintenance_per_km", v)}
          head="maintenance"
          isIncluded={isIncluded}
          onToggle={toggleHead}
        />

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Tyres</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                className={checkboxCls}
                checked={isIncluded("tyres")}
                onChange={(e) => toggleHead("tyres", e.target.checked)}
              />
              Include tyres
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SubField
              label="Count"
              value={tyresCount}
              onChange={(v) => setOverride("tyres_count", v)}
            />
            <SubField
              label="Cost per tyre (₹)"
              value={tyresCostPerTyre}
              onChange={(v) => setOverride("tyres_cost_per_tyre", v)}
            />
            <SubField
              label="Life (km)"
              value={tyresLifeKm}
              onChange={(v) => setOverride("tyres_life_km", v)}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Depreciation</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                className={checkboxCls}
                checked={isIncluded("depreciation_usage") && isIncluded("depreciation_aging")}
                onChange={(e) => {
                  // A single checkbox governs both depreciation heads since
                  // they share the same underlying inputs.
                  const included = e.target.checked;
                  const next = included
                    ? excludedHeads.filter(
                        (h) => h !== "depreciation_usage" && h !== "depreciation_aging"
                      )
                    : [
                        ...excludedHeads.filter(
                          (h) => h !== "depreciation_usage" && h !== "depreciation_aging"
                        ),
                        "depreciation_usage" as CostHeadId,
                        "depreciation_aging" as CostHeadId,
                      ];
                  onChange(overrides, next);
                }}
              />
              Include depreciation
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SubField
              label="Ex-showroom price (₹)"
              value={exShowroomInr}
              onChange={(v) => setOverride("ex_showroom_inr", v)}
              badge={priceSource}
            />
            <SubField
              label="Salvage % (0-1)"
              value={salvagePct}
              onChange={(v) => setOverride("salvage_pct", v)}
            />
            <SubField
              label="Life (years)"
              value={lifeYears}
              onChange={(v) => setOverride("life_years", v)}
            />
            <SubField
              label="Life (km)"
              value={lifeKm}
              onChange={(v) => setOverride("life_km", v)}
            />
            <SubField
              label="Aging share (0-1)"
              value={depreciationAgingShare}
              onChange={(v) => setOverride("depreciation_aging_share", v)}
            />
            <SubField
              label="Usage share (0-1)"
              value={depreciationUsageShare}
              onChange={(v) => setOverride("depreciation_usage_share", v)}
            />
          </div>
        </div>

        <FieldRow
          label="Insurance (₹/year)"
          value={insurancePerYear}
          onChange={(v) => setOverride("insurance_per_year", v)}
          head="insurance"
          isIncluded={isIncluded}
          onToggle={toggleHead}
        />
        <FieldRow
          label="Road tax (₹/year)"
          value={roadTaxPerYear}
          onChange={(v) => setOverride("road_tax_per_year", v)}
          head="road_tax"
          isIncluded={isIncluded}
          onToggle={toggleHead}
        />
        <FieldRow
          label="Fitness (₹/year)"
          value={fitnessPerYear}
          onChange={(v) => setOverride("fitness_per_year", v)}
          head="fitness"
          isIncluded={isIncluded}
          onToggle={toggleHead}
        />
        <FieldRow
          label="Interest (₹/year)"
          value={interestPerYear}
          onChange={(v) => setOverride("interest_per_year", v)}
          head="interest"
          isIncluded={isIncluded}
          onToggle={toggleHead}
        />
      </div>

      {/* ── Section 2: off-by-default add-ons ───────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowAddMore(!showAddMore)}
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          {showAddMore ? "Hide" : "Add more components"}
        </button>

        {showAddMore && (
          <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <FieldRow
              label="Helper salary (₹/day)"
              value={helperPerDay}
              onChange={(v) => setOverride("helper_per_day", v)}
              head="helper"
              isIncluded={isIncluded}
              onToggle={toggleHead}
            />
            <FieldRow
              label="GPS (₹/year)"
              value={gpsPerYear}
              onChange={(v) => setOverride("gps_per_year", v)}
              head="gps"
              isIncluded={isIncluded}
              onToggle={toggleHead}
            />
            <FieldRow
              label="FASTag fee (₹/year)"
              value={fastagFeePerYear}
              onChange={(v) => setOverride("fastag_fee_per_year", v)}
              head="fastag_fee"
              isIncluded={isIncluded}
              onToggle={toggleHead}
            />
            <FieldRow
              label="RTO/misc (₹/year)"
              value={rtoMiscPerYear}
              onChange={(v) => setOverride("rto_misc_per_year", v)}
              head="rto_misc"
              isIncluded={isIncluded}
              onToggle={toggleHead}
            />
            <FieldRow
              label="Tarpaulin (₹/year)"
              value={tarpaulinPerYear}
              onChange={(v) => setOverride("tarpaulin_per_year", v)}
              head="tarpaulin"
              isIncluded={isIncluded}
              onToggle={toggleHead}
            />
            <FieldRow
              label="Other fixed (₹/year)"
              value={otherFixedPerYear}
              onChange={(v) => setOverride("other_fixed_per_year", v)}
              head="other_fixed"
              isIncluded={isIncluded}
              onToggle={toggleHead}
            />
          </div>
        )}
      </div>

      {/* ── Section 3: return-load probability ──────────────────────── */}
      <div>
        <label htmlFor="empty-return-pct" className="mb-1 block text-sm font-medium text-slate-700">
          Return-load probability (0 = always gets a paid return load, 1 = always returns empty)
        </label>
        <input
          id="empty-return-pct"
          type="number"
          step="any"
          min={0}
          max={1}
          value={emptyReturnPct}
          onChange={(e) => setOverride("empty_return_pct", e.target.value)}
          className={inputCls}
        />
      </div>

      {/* ── Section 4: expandable truck-data reference table ───────── */}
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          Truck data reference
        </summary>
        <table className="mt-2 w-full text-left text-xs text-slate-600">
          <tbody>
            {Object.entries(profile).map(([key, value]) => (
              <tr key={key} className="border-t border-slate-100">
                <td className="py-1 pr-3 font-medium text-slate-500">{key}</td>
                <td className="py-1">
                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                </td>
              </tr>
            ))}
            {model && (
              <>
                <tr className="border-t border-slate-100">
                  <td className="py-1 pr-3 font-medium text-slate-500">model.mileage_kmpl</td>
                  <td className="py-1">
                    <span className="mr-2">{model.mileage_kmpl.value}</span>
                    <CostSourceBadge source={model.mileage_kmpl.source} />
                  </td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="py-1 pr-3 font-medium text-slate-500">model.ex_showroom_inr</td>
                  <td className="py-1">
                    <span className="mr-2">{model.ex_showroom_inr.value}</span>
                    <CostSourceBadge source={model.ex_showroom_inr.source} />
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// Simple labelled number input used for the always-visible fields — mirrors
// TripForm.tsx's OverrideField visual pattern. When `head`/`isIncluded`/
// `onToggle` are supplied, also renders an include/exclude checkbox.
function FieldRow({
  label,
  value,
  onChange,
  head,
  isIncluded,
  onToggle,
  badge,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
  head?: CostHeadId;
  isIncluded?: (head: CostHeadId) => boolean;
  onToggle?: (head: CostHeadId, included: boolean) => void;
  badge?: CostSource | null;
}) {
  // Slug the label into a stable id so <label htmlFor> associates with the
  // input — required for screen.getByLabelText() in tests, and for a11y.
  const id = `field-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1">
        <label htmlFor={id} className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
          {label}
          {badge && <CostSourceBadge source={badge} />}
        </label>
        <input
          id={id}
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      </div>
      {head && isIncluded && onToggle && (
        <label className="mb-2 flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            className={checkboxCls}
            checked={isIncluded(head)}
            onChange={(e) => onToggle(head, e.target.checked)}
          />
          Include
        </label>
      )}
    </div>
  );
}

// Compact input used inside the Tyres/Depreciation grouped cards — no
// individual exclude checkbox since one checkbox governs the whole head.
function SubField({
  label,
  value,
  onChange,
  badge,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
  badge?: CostSource | null;
}) {
  const id = `subfield-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 flex items-center gap-1.5 text-xs text-slate-600">
        {label}
        {badge && <CostSourceBadge source={badge} />}
      </label>
      <input
        id={id}
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </div>
  );
}
