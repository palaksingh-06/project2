"use client";

import { useState } from "react";
import truckRatesJson from "@/config/truck-rates.json";
import { BreakdownChart } from "@/components/BreakdownChart";
import { CostBreakdownTable } from "@/components/CostBreakdownTable";
import {
  TripForm,
  type CalculateRequest,
} from "@/components/TripForm";
import type { ContributionCheck } from "@/lib/zbc/types";
import type { BreakdownRow } from "@/components/CostBreakdownTable";

interface CalculateResponse {
  total: number;
  subtotal: number;
  breakdown: BreakdownRow[];
  contributions: ContributionCheck[];
  meta: {
    trip_days: number;
    distance_km: number;
    origin: { name: string; state: string };
    destination: { name: string; state: string };
    toll: { plazas: number; highway?: string };
    fuel: { price_inr: number; state: string };
  };
  error?: string;
  suggestions?: string[];
}

function formatInr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CalculateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showContribution, setShowContribution] = useState(true);

  const truckRates = truckRatesJson.trucks;

  async function handleCalculate(req: CalculateRequest) {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setResult(null);

    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const data = (await res.json()) as CalculateResponse & {
        error?: string;
        suggestions?: string[];
      };

      if (!res.ok) {
        setError(data.error ?? "Calculation failed");
        if (data.suggestions?.length) setSuggestions(data.suggestions);
        return;
      }

      setResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Zero Based Costing Calculator
          </h1>
          <p className="mt-1 text-slate-600">
            Estimate freight trip cost across 10 cost heads.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Trip details</h2>
          <TripForm
            onSubmit={handleCalculate}
            loading={loading}
            truckRates={truckRates}
          />
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
              {suggestions.length > 0 && (
                <p className="mt-2">
                  Did you mean: {suggestions.join(", ")}?
                </p>
              )}
            </div>
          )}
        </section>

        <section className="space-y-4">
          {loading && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
              Fetching route, tolls, and fuel price…
            </div>
          )}

          {result && !loading && (
            <>
              <div className="rounded-xl border border-brand-100 bg-brand-50 p-6">
                <p className="text-sm font-medium text-brand-700">
                  Total trip cost
                </p>
                <p className="mt-1 text-3xl font-bold text-brand-900">
                  {formatInr(result.total)}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {result.meta.distance_km} km · {result.meta.trip_days} day
                  {result.meta.trip_days > 1 ? "s" : ""} · Diesel ₹
                  {result.meta.fuel.price_inr}/L ({result.meta.fuel.state})
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showContribution}
                  onChange={(e) => setShowContribution(e.target.checked)}
                />
                Show benchmark check
              </label>

              <BreakdownChart
                data={result.breakdown.map((r) => ({
                  name: r.name.replace(/ \(.*\)/, ""),
                  amount: r.amount_inr,
                }))}
              />

              <CostBreakdownTable
                rows={result.breakdown}
                contributions={result.contributions}
                showContribution={showContribution}
              />
            </>
          )}

          {!result && !loading && !error && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
              Enter trip details and calculate to see breakdown
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
