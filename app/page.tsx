"use client";

import { useState } from "react";
import truckRatesJson from "@/config/truck-rates.json";
import { BreakdownChart } from "@/components/BreakdownChart";
import { CostBreakdownTable } from "@/components/CostBreakdownTable";
import { BatchUpload } from "@/components/BatchUpload";
import { BatchResultsTable } from "@/components/BatchResultsTable";
import {
  TripForm,
  type CalculateRequest,
} from "@/components/TripForm";
import { downloadSingleTripExcel } from "@/lib/export/excel";
import type { ContributionCheck } from "@/lib/zbc/types";
import type { BreakdownRow } from "@/components/CostBreakdownTable";
import type { BatchRowResult } from "@/lib/export/excel";

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
  // Single-trip state
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CalculateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showContribution, setShowContribution] = useState(true);
  const [lastRequest, setLastRequest] = useState<CalculateRequest | null>(null);

  // Batch state
  const [tab, setTab] = useState<"single" | "batch">("single");
  const [batchResults, setBatchResults] = useState<BatchRowResult[]>([]);

  const truckRates = truckRatesJson.trucks;

  // Calls /api/calculate for a single trip submission
  async function handleCalculate(req: CalculateRequest) {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setResult(null);
    setLastRequest(req);

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
      {/* Page header */}
      <header className="border-b border-slate-200 bg-white" data-print="hide">
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
        {/* Left column: tab switcher + form or batch upload */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" data-print="hide">
          {/* Tab switcher */}
          <div className="mb-5 flex rounded-lg border border-slate-200 p-1">
            <button
              onClick={() => setTab("single")}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                tab === "single"
                  ? "bg-brand-700 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Single Trip
            </button>
            <button
              onClick={() => setTab("batch")}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                tab === "batch"
                  ? "bg-brand-700 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Batch Upload
            </button>
          </div>

          {/* Single trip form */}
          {tab === "single" && (
            <>
              <TripForm
                onSubmit={handleCalculate}
                loading={loading}
                truckRates={truckRates}
              />
              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                  {suggestions.length > 0 && (
                    <p className="mt-2">Did you mean: {suggestions.join(", ")}?</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Batch CSV upload */}
          {tab === "batch" && (
            <BatchUpload onResults={(rows) => setBatchResults(rows)} />
          )}
        </section>

        {/* Right column: results */}
        <section className="space-y-4">
          {/* Single trip loading state */}
          {tab === "single" && loading && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
              Fetching route, tolls, and fuel price…
            </div>
          )}

          {/* Single trip results */}
          {tab === "single" && result && !loading && (
            <>
              {/* Total cost card */}
              <div className="rounded-xl border border-brand-100 bg-brand-50 p-6">
                <p className="text-sm font-medium text-brand-700">Total trip cost</p>
                <p className="mt-1 text-3xl font-bold text-brand-900">
                  {formatInr(result.total)}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {result.meta.distance_km} km · {result.meta.trip_days} day
                  {result.meta.trip_days > 1 ? "s" : ""} · Diesel ₹
                  {result.meta.fuel.price_inr}/L ({result.meta.fuel.state})
                </p>
              </div>

              {/* Export buttons for single trip */}
              <div className="flex gap-2" data-print="hide">
                <button
                  onClick={() =>
                    downloadSingleTripExcel(
                      // Pass the result with meta shaped to match the export function
                      {
                        ...result,
                        meta: {
                          ...result.meta,
                          origin: { name: result.meta.origin.name },
                          destination: { name: result.meta.destination.name },
                        },
                      },
                      { truckId: lastRequest?.truckId ?? "" }
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  Download Excel
                </button>
                <button
                  onClick={() => window.print()}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  Print / PDF
                </button>
              </div>

              {/* Benchmark toggle */}
              <label className="flex items-center gap-2 text-sm text-slate-600" data-print="hide">
                <input
                  type="checkbox"
                  checked={showContribution}
                  onChange={(e) => setShowContribution(e.target.checked)}
                />
                Show benchmark check
              </label>

              {/* Cost breakdown bar chart */}
              <BreakdownChart
                data={result.breakdown.map((r) => ({
                  name: r.name.replace(/ \(.*\)/, ""),
                  amount: r.amount_inr,
                }))}
              />

              {/* Detailed cost breakdown table with expandable rows */}
              <CostBreakdownTable
                rows={result.breakdown}
                contributions={result.contributions}
                showContribution={showContribution}
              />
            </>
          )}

          {/* Single trip empty state */}
          {tab === "single" && !result && !loading && !error && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
              Enter trip details and calculate to see breakdown
            </div>
          )}

          {/* Batch results */}
          {tab === "batch" && batchResults.length > 0 && (
            <BatchResultsTable results={batchResults} />
          )}

          {/* Batch empty state */}
          {tab === "batch" && batchResults.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
              Upload a CSV to see batch results here
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
