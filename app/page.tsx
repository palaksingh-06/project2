
"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
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
import { generateMethodologyMd } from "@/lib/export/methodology";
import { ProvenanceDrawer } from "@/components/ProvenanceDrawer";
import { ConfigurationTab } from "@/components/ConfigurationTab";
import type {
  ContributionCheck,
  RateOverrides,
  CostHeadId,
} from "@/lib/zbc/types";
import type { BreakdownRow } from "@/components/CostBreakdownTable";
import type { BatchRowResult } from "@/lib/export/excel";
import { RouteMap } from "@/components/RouteMap";

interface ProvenanceInfo {
  kind: string;
  label: string;
  detail?: string;
  updated_at?: string;
}

interface CalculateResponse {
  total: number;
  subtotal: number;
  breakdown: BreakdownRow[];
  contributions: ContributionCheck[];
  meta: {
    trip_days: number;
    distance_km: number;

    origin: {
      name: string;
      state: string;
      lat?: number;
      lng?: number;
      provenance?: ProvenanceInfo;
      name_provenance?: ProvenanceInfo;
    };

    destination: {
      name: string;
      state: string;
      lat?: number;
      lng?: number;
      provenance?: ProvenanceInfo;
      name_provenance?: ProvenanceInfo;
    };

    inputs?: {
      geocode_origin?: ProvenanceInfo;
      geocode_origin_name?: ProvenanceInfo;
      geocode_destination?: ProvenanceInfo;
      geocode_destination_name?: ProvenanceInfo;
      distance?: ProvenanceInfo;
      fuel?: ProvenanceInfo;
      toll?: ProvenanceInfo;
    };

    cost_heads?: Record<string, ProvenanceInfo>;

    toll: {
      plazas: number;
      highway?: string;
    };

    fuel: {
      price_inr: number;
      state: string;
    };

    truck?: {
      truck_id: string;
      truck_label: string;
      model_id?: string;
      model_label?: string;
      mileage_used: number;
      provenance: ProvenanceInfo;
    };
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
  const [showChart, setShowChart] = useState(false);

  const [lastRequest, setLastRequest] =
    useState<CalculateRequest | null>(null);

  const [tab, setTab] = useState<"single" | "batch">("single");

  const [batchResults, setBatchResults] =
    useState<BatchRowResult[]>([]);

  const [formMinimized, setFormMinimized] = useState(false);

  const [activeResultTab, setActiveResultTab] = useState<
    "configuration" | "breakdown" | "route"
  >("breakdown");

  const [configOverrides, setConfigOverrides] =
    useState<RateOverrides>({});

  const [excludedHeads, setExcludedHeads] =
    useState<CostHeadId[]>([]);

  const [provenanceResult, setProvenanceResult] =
    useState<CalculateResponse | null>(null);

  const skipNextRecomputeRef = useRef(false);

  const truckRates = truckRatesJson.trucks;

  async function handleCalculate(
    req: CalculateRequest,
    opts?: { silent?: boolean }
  ) {
    if (!opts?.silent) {
      setLoading(true);
      setResult(null);

      setConfigOverrides({});
      setExcludedHeads([]);

      skipNextRecomputeRef.current = true;
    }

    setError(null);
    setSuggestions([]);
    setLastRequest(req);

    try {
      const res = await fetch("/api/newcalculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req),
      });

      const data = (await res.json()) as CalculateResponse & {
        error?: string;
        suggestions?: string[];
      };

      if (!res.ok) {
        setError(data.error ?? "Calculation failed");

        if (data.suggestions?.length) {
          setSuggestions(data.suggestions);
        }

        return;
      }

      setResult(data);

      if (!opts?.silent) {
        setFormMinimized(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!lastRequest) return;

    if (skipNextRecomputeRef.current) {
      skipNextRecomputeRef.current = false;
      return;
    }

    const handle = setTimeout(() => {
      const merged: CalculateRequest = {
        ...lastRequest,
        overrides: {
          ...lastRequest.overrides,
          ...configOverrides,
        },
        excluded_heads: excludedHeads,
      };

      handleCalculate(merged, {
        silent: true,
      });
    }, 400);

    return () => clearTimeout(handle);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configOverrides, excludedHeads]);

  function downloadMethodology() {
    const md = generateMethodologyMd();

    const blob = new Blob([md], {
      type: "text/markdown",
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = "zbc-methodology.md";

    a.click();

    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* ========================================================= */}
      {/* GLOBAL STYLES */}
      {/* ========================================================= */}

      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap");

        body {
          font-family: "Inter", sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .price-heading {
          font-family: "Plus Jakarta Sans", sans-serif;
        }

        .glass-panel {
          backdrop-filter: blur(20px) saturate(190%);
          -webkit-backdrop-filter: blur(20px) saturate(190%);
          background: rgba(255, 255, 255, 0.24);
          border: 1px solid rgba(255, 255, 255, 0.45);
          border-top: 1px solid rgba(255, 255, 255, 0.65);
          border-left: 1px solid rgba(255, 255, 255, 0.6);
          box-shadow:
            0 20px 50px rgba(0, 0, 0, 0.15),
            0 1px 3px rgba(255, 255, 255, 0.35) inset;
        }

        .glass-card {
          background: rgba(255, 255, 255, 0.48);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.62);
          box-shadow:
            0 10px 30px rgba(15, 23, 42, 0.08),
            inset 0 1px 2px rgba(255, 255, 255, 0.4);
        }

        .glass-input-wrapper input,
        .glass-input-wrapper select {
          background: rgba(255, 255, 255, 0.48) !important;
          border: 1px solid rgba(255, 255, 255, 0.65) !important;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .glass-input-wrapper input:focus,
        .glass-input-wrapper select:focus {
          background: rgba(255, 255, 255, 0.75) !important;
          border-color: #2563eb !important;
          outline: none !important;
          box-shadow:
            0 0 0 3px rgba(37, 99, 235, 0.2) !important;
        }

        input::placeholder {
          color: rgba(15, 23, 42, 0.55);
        }

        @keyframes truckDriveBob {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }

          30% {
            transform: translateY(-3px) rotate(0.4deg);
          }

          60% {
            transform: translateY(1px) rotate(-0.25deg);
          }

          85% {
            transform: translateY(-1px) rotate(0.1deg);
          }
        }

        @keyframes minimalRoadMove {
          0% {
            transform: translateX(0);
          }

          100% {
            transform: translateX(-50%);
          }
        }

        @keyframes windParticle {
          0% {
            transform: translateX(100px);
            opacity: 0;
          }

          20% {
            opacity: 0.6;
          }

          80% {
            opacity: 0.6;
          }

          100% {
            transform: translateX(-180px);
            opacity: 0;
          }
        }

        .truck-bob {
          animation: truckDriveBob 1.8s ease-in-out infinite;
        }

        .road-dashes {
          animation: minimalRoadMove 0.85s linear infinite;
        }

        .wind-1 {
          animation: windParticle 1.4s
            cubic-bezier(0.2, 0, 0.8, 1) infinite;
        }

        .wind-2 {
          animation: windParticle 1.9s
            cubic-bezier(0.3, 0, 0.7, 1) infinite 0.6s;
        }

        .wind-3 {
          animation: windParticle 1.6s
            cubic-bezier(0.25, 0, 0.75, 1) infinite 1.1s;
        }

  .truck-image {
  object-fit: contain;
}
      `}</style>

      {/* ========================================================= */}
      {/* PAGE */}
      {/* ========================================================= */}

      <main
        className="min-h-screen text-slate-900"
        style={{
          background:
            "linear-gradient(135deg, rgb(108,120,146) 0%, rgb(126,139,159) 35%, rgb(154,166,184) 65%, rgb(200,209,222) 100%)",
        }}
      >
        {/* Ambient background */}

        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-[15%] -left-[10%] h-[55vw] w-[55vw] rounded-full bg-white/15 blur-3xl" />

          <div className="absolute right-[10%] top-[20%] h-[50vw] w-[50vw] rounded-full bg-slate-400/20 blur-3xl" />

          <div className="absolute -bottom-[20%] left-[25%] h-[60vw] w-[60vw] rounded-full bg-white/20 blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto max-w-[1440px] px-5 py-7 md:px-8 lg:px-12 lg:py-9">
          {/* ===================================================== */}
          {/* HEADER */}
          {/* ===================================================== */}

          <header
            className="flex flex-col gap-5 pb-8 sm:flex-row sm:items-center sm:justify-between"
            data-print="hide"
          >
            <div className="flex items-center gap-4 sm:gap-5">
              {}
<div className="flex h-16 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/60 bg-white/95 px-2 py-1 shadow-md">
  <Image
    src="/images/logo.png"
    alt="ACG Logo"
    width={100}
    height={60}
    className="h-full w-full object-contain"
    priority
  />
</div>

              <div className="hidden h-9 w-px bg-white/30 sm:block" />

              <div>
                <h1 className="price-heading flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900 drop-shadow-sm md:text-[28px]">
                  PriceMyTrip
                </h1>

                <p className="mt-0.5 text-[13px] font-medium text-slate-700 md:text-[14px]">
                  Estimate freight trip cost across fixed, variable,
                  and margin cost heads.
                </p>
              </div>
            </div>

            <button
              onClick={downloadMethodology}
              className="inline-flex items-center gap-2 self-start rounded-xl border border-white/80 bg-white/85 px-4 py-2.5 text-[13px] font-semibold text-slate-800 shadow-sm backdrop-blur-md transition-all hover:bg-white hover:shadow-md sm:self-center"
            >
              Download methodology

              <span className="text-xs font-bold text-slate-600">
                ↓
              </span>
            </button>
          </header>

          {/* ===================================================== */}
          {/* MAIN TWO COLUMN LAYOUT */}
          {/* ===================================================== */}

          <div
            className={`
              grid items-start gap-8
              ${
                formMinimized
                  ? "grid-cols-1"
                  : "grid-cols-1 lg:grid-cols-12"
              }
            `}
          >
            {/* =================================================== */}
            {/* LEFT FORM */}
            {/* =================================================== */}

            {!formMinimized ? (
              <section
                className="relative rounded-2xl p-5 sm:p-7 lg:col-span-5"
                style={{
                  backdropFilter: "blur(20px) saturate(190%)",
                  background: "rgba(255,255,255,0.24)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  boxShadow:
                    "0 20px 50px rgba(0,0,0,.15), inset 0 1px 3px rgba(255,255,255,.35)",
                }}
                data-print="hide"
              >
                {/* Minimize */}

                <div className="mb-3 flex justify-end">
                  <button
                    onClick={() => setFormMinimized(true)}
                    className="flex items-center gap-1 text-xs font-semibold text-white/80 transition-colors hover:text-white"
                  >
                    ◂ Minimize
                  </button>
                </div>

                {/* Tabs */}

                <div className="mb-6 flex w-full gap-1 rounded-xl border border-white/30 bg-black/10 p-1.5 shadow-inner backdrop-blur-md">
                  <button
                    onClick={() => setTab("single")}
                    className={`
                      flex-1 rounded-lg py-2 px-3 text-center text-sm
                      transition-all
                      ${
                        tab === "single"
                          ? "bg-white/90 font-bold text-blue-900 shadow-md"
                          : "font-medium text-white/90 hover:bg-white/15 hover:text-white"
                      }
                    `}
                  >
                    Single Trip
                  </button>

                  <button
                    onClick={() => setTab("batch")}
                    className={`
                      flex-1 rounded-lg py-2 px-3 text-center text-sm
                      transition-all
                      ${
                        tab === "batch"
                          ? "bg-white/90 font-bold text-blue-900 shadow-md"
                          : "font-medium text-white/90 hover:bg-white/15 hover:text-white"
                      }
                    `}
                  >
                    Batch Upload
                  </button>
                </div>

                {/* ================================================= */}
                {/* SINGLE TRIP */}
                {/* ================================================= */}

                {tab === "single" && (
                  <>
                    <div className="glass-input-wrapper">
                      <TripForm
                        onSubmit={handleCalculate}
                        loading={loading}
                        truckRates={truckRates}
                      />
                    </div>

                    {error && (
                      <div className="mt-4 rounded-xl border border-red-300/60 bg-red-100/80 p-3 text-sm font-medium text-red-900 backdrop-blur-md">
                        {error}

                        {suggestions.length > 0 && (
                          <p className="mt-2">
                            Did you mean:{" "}
                            <strong>
                              {suggestions.join(", ")}
                            </strong>
                            ?
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ================================================= */}
                {/* BATCH */}
                {/* ================================================= */}

                {tab === "batch" && (
                  <div className="glass-input-wrapper">
                    <BatchUpload
                      onResults={(rows) =>
                        setBatchResults(rows)
                      }
                    />
                  </div>
                )}
              </section>
            ) : (
              <button
                onClick={() => setFormMinimized(false)}
                className="flex w-fit items-center gap-2 rounded-xl border border-white/60 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur-md transition-all hover:bg-white"
                data-print="hide"
              >
                ▸ Show input form
              </button>
            )}

            {/* =================================================== */}
            {/* RIGHT RESULTS */}
            {/* =================================================== */}

            <section
              className={
                formMinimized
                  ? "min-w-0"
                  : "min-w-0 lg:col-span-7"
              }
            >
              {/* ================================================= */}
              {/* LOADING */}
              {/* ================================================= */}

              {tab === "single" && loading && (
                <div className="flex min-h-[520px] flex-col items-center justify-center">
                  <div className="mb-5 h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-blue-700" />

                  <p className="text-sm font-semibold text-slate-700">
                    Fetching route, tolls, and fuel price…
                  </p>
                </div>
              )}

              {/* ================================================= */}
              {/* EMPTY STATE */}
              {/* ================================================= */}

              {tab === "single" &&
                !result &&
                !loading &&
                !error && (
                  <div className="relative flex min-h-[520px] flex-col items-center justify-center overflow-hidden select-none">
                    {/* Wind */}

                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                      <div className="wind-1 absolute left-[20%] top-[35%] h-[2px] w-14 rounded-full bg-slate-700/30" />

                      <div className="wind-2 absolute left-[16%] top-[48%] h-[2.5px] w-20 rounded-full bg-slate-800/25" />

                      <div className="wind-3 absolute left-[24%] top-[58%] h-[2px] w-12 rounded-full bg-slate-700/30" />
                    </div>

                    <div className="relative flex w-full max-w-[560px] flex-col items-center justify-center">

                     <div className="truck-bob relative z-10 flex w-full items-center justify-center">
                        <Image
                          src="/images/truck.png"
                            alt="Freight truck"
                            width={460}
                            height={300}
                            className="truck-image pointer-events-none w-[320px] object-contain sm:w-[410px] md:w-[460px]"
                            priority
                          />
                        </div>

                      {/* Road */}

                      <div className="relative z-20 -mt-[58px] flex w-full max-w-[520px] flex-col items-center sm:-mt-[70px] md:-mt-[82px]">
                        <div className="h-[2.5px] w-full rounded-full bg-slate-700/40" />

                        <div className="mt-2 h-3 w-full overflow-hidden opacity-75">
                          <div className="road-dashes flex min-w-[200%] gap-8 whitespace-nowrap">
                            {Array.from({
                              length: 12,
                            }).map((_, index) => (
                              <span
                                key={index}
                                className="inline-block h-[3px] w-12 rounded-full bg-slate-800/70"
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-10 text-center">
                      <p className="price-heading text-xl font-extrabold text-slate-800">
                        Ready to price your trip?
                      </p>

                      <p className="mt-1 text-sm font-medium text-slate-600">
                        Enter your trip details to calculate
                        the estimated freight cost.
                      </p>
                    </div>
                  </div>
                )}

              {/* ================================================= */}
              {/* BATCH RESULTS */}
              {/* ================================================= */}

              {tab === "batch" &&
                batchResults.length > 0 && (
                  <div className="glass-panel rounded-2xl p-5 sm:p-7">
                    <BatchResultsTable
                      results={batchResults}
                      onShowProvenance={(r) =>
                        setProvenanceResult(
                          r as unknown as CalculateResponse
                        )
                      }
                    />
                  </div>
                )}

              {tab === "batch" &&
                batchResults.length === 0 && (
                  <div className="glass-panel flex min-h-[480px] items-center justify-center rounded-2xl p-10 text-center">
                    <div>
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/60 text-2xl shadow-sm">
                        ↑
                      </div>

                      <h2 className="price-heading text-lg font-bold text-slate-800">
                        Upload your trip data
                      </h2>

                      <p className="mt-1 text-sm font-medium text-slate-600">
                        Upload a CSV to calculate multiple
                        trips at once.
                      </p>
                    </div>
                  </div>
                )}

              {/* ================================================= */}
              {/* SINGLE RESULT */}
              {/* ================================================= */}

              {tab === "single" &&
                result &&
                !loading && (
                  <div className="space-y-5">
                    {/* Result tabs */}

                    <div
                      className="flex gap-1 overflow-x-auto border-b border-white/30"
                      data-print="hide"
                    >
                      {(
                        [
                          "configuration",
                          "breakdown",
                          "route",
                        ] as const
                      ).map((t) => (
                        <button
                          key={t}
                          onClick={() =>
                            setActiveResultTab(t)
                          }
                          className={`
                            whitespace-nowrap px-4 py-2.5 text-sm
                            font-semibold capitalize transition-all
                            ${
                              activeResultTab === t
                                ? "border-b-2 border-blue-800 text-blue-900"
                                : "text-slate-600 hover:text-slate-900"
                            }
                          `}
                        >
                          {t === "route"
                            ? "Route Map"
                            : t === "configuration"
                            ? "Configuration"
                            : "Cost Breakdown"}
                        </button>
                      ))}
                    </div>

                    {/* ================================================= */}
                    {/* MAIN RESULT CARD */}
                    {/* ================================================= */}

                    <div className="glass-panel rounded-2xl p-5 sm:p-7">
                      {/* Header */}

                      <div className="flex flex-col justify-between gap-4 border-b border-white/30 pb-5 sm:flex-row sm:items-center">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                            Total Estimated Cost
                          </span>

                          <div className="mt-1 flex items-baseline gap-2">
                            <span className="price-heading text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                              {formatInr(result.total)}
                            </span>

                            <span className="rounded-md border border-emerald-300 bg-emerald-100/90 px-2 py-0.5 text-xs font-bold text-emerald-900">
                              all inclusive
                            </span>
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/60 bg-white/50 px-3.5 py-2 text-left backdrop-blur-md sm:text-right">
                          <span className="block text-xs font-semibold text-slate-700">
                            Computed Route:
                          </span>

                          <span className="text-sm font-extrabold text-slate-950">
                            {result.meta.origin.name}
                            {" → "}
                            {result.meta.destination.name}
                            {" "}
                            ({result.meta.distance_km} km)
                          </span>
                        </div>
                      </div>

                      {/* Data sources */}

                      <div
                        className="mt-4 flex justify-end"
                        data-print="hide"
                      >
                        <button
                          onClick={() =>
                            setProvenanceResult(result)
                          }
                          className="rounded-xl border border-white/70 bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-all hover:bg-white"
                        >
                          View data sources →
                        </button>
                      </div>

                      {/* ================================================= */}
                      {/* BREAKDOWN TAB */}
                      {/* ================================================= */}

                      {activeResultTab === "breakdown" && (
                        <div className="mt-4 space-y-5">
                          {/* Allocation */}

                          <div>
                            <div className="mb-2 flex justify-between text-xs font-bold text-slate-800">
                              <span>
                                Cost Head Allocation
                              </span>

                              <span className="rounded border border-white/50 bg-white/70 px-2 py-0.5 text-blue-950">
                                100% Modeled
                              </span>
                            </div>

                            <div className="flex h-3.5 w-full overflow-hidden rounded-full border border-white/40 bg-black/15 p-0.5 shadow-inner">
                              {result.breakdown.map(
                                (row, index) => {
                                  const total =
                                    result.breakdown.reduce(
                                      (sum, item) =>
                                        sum +
                                        item.amount_inr,
                                      0
                                    );

                                  const percentage =
                                    total > 0
                                      ? (row.amount_inr /
                                          total) *
                                        100
                                      : 0;

                                  return (
                                    <div
                                      key={`${row.name}-${index}`}
                                      className={`
                                        h-full
                                        ${
                                          index === 0
                                            ? "rounded-l-full"
                                            : ""
                                        }
                                        ${
                                          index ===
                                          result.breakdown
                                            .length -
                                            1
                                            ? "rounded-r-full"
                                            : ""
                                        }
                                        ${
                                          index % 4 === 0
                                            ? "bg-blue-600"
                                            : index % 4 ===
                                              1
                                            ? "bg-indigo-600"
                                            : index % 4 ===
                                              2
                                            ? "bg-slate-500"
                                            : "bg-emerald-600"
                                        }
                                      `}
                                      style={{
                                        width: `${percentage}%`,
                                      }}
                                      title={`${row.name}: ${percentage.toFixed(
                                        1
                                      )}%`}
                                    />
                                  );
                                }
                              )}
                            </div>
                          </div>

                          {/* Result meta */}

                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <div className="glass-card rounded-xl p-3">
                              <p className="text-[11px] font-bold uppercase text-slate-600">
                                Distance
                              </p>

                              <p className="mt-1 text-lg font-extrabold text-slate-900">
                                {result.meta.distance_km}{" "}
                                km
                              </p>
                            </div>

                            <div className="glass-card rounded-xl p-3">
                              <p className="text-[11px] font-bold uppercase text-slate-600">
                                Trip Duration
                              </p>

                              <p className="mt-1 text-lg font-extrabold text-slate-900">
                                {result.meta.trip_days}{" "}
                                day
                                {result.meta.trip_days >
                                1
                                  ? "s"
                                  : ""}
                              </p>
                            </div>

                            <div className="glass-card rounded-xl p-3">
                              <p className="text-[11px] font-bold uppercase text-slate-600">
                                Diesel
                              </p>

                              <p className="mt-1 text-lg font-extrabold text-slate-900">
                                ₹
                                {
                                  result.meta.fuel
                                    .price_inr
                                }
                                /L
                              </p>
                            </div>

                            <div className="glass-card rounded-xl p-3">
                              <p className="text-[11px] font-bold uppercase text-slate-600">
                                Toll Plazas
                              </p>

                              <p className="mt-1 text-lg font-extrabold text-slate-900">
                                {
                                  result.meta.toll
                                    .plazas
                                }
                              </p>
                            </div>
                          </div>

                          {/* Export */}

                          <div
                            className="flex flex-wrap gap-2"
                            data-print="hide"
                          >
                            <button
                              onClick={() =>
                                downloadSingleTripExcel(
                                  {
                                    ...result,
                                    meta: {
                                      ...result.meta,
                                      origin: {
                                        name: result.meta
                                          .origin
                                          .name,
                                      },
                                      destination: {
                                        name: result.meta
                                          .destination
                                          .name,
                                      },
                                    },
                                  },
                                  {
                                    truckId:
                                      lastRequest?.truckId ??
                                      "",
                                  }
                                )
                              }
                              className="rounded-xl border border-white/70 bg-white/75 px-4 py-2 text-xs font-bold text-slate-800 shadow-sm transition-all hover:bg-white"
                            >
                              Download Excel
                            </button>

                            <button
                              onClick={() => window.print()}
                              className="rounded-xl border border-white/70 bg-white/75 px-4 py-2 text-xs font-bold text-slate-800 shadow-sm transition-all hover:bg-white"
                            >
                              Print / PDF
                            </button>
                          </div>

                          {/* Toggles */}

                          <div className="flex flex-wrap gap-5">
                            <label
                              className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700"
                              data-print="hide"
                            >
                              <input
                                type="checkbox"
                                checked={
                                  showContribution
                                }
                                onChange={(e) =>
                                  setShowContribution(
                                    e.target.checked
                                  )
                                }
                                className="h-4 w-4 rounded border-slate-300"
                              />

                              Show benchmark check
                            </label>

                            <label
                              className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700"
                              data-print="hide"
                            >
                              <input
                                type="checkbox"
                                checked={showChart}
                                onChange={(e) =>
                                  setShowChart(
                                    e.target.checked
                                  )
                                }
                                className="h-4 w-4 rounded border-slate-300"
                              />

                              Show cost breakdown chart
                            </label>
                          </div>

                          {showChart && (
                            <div className="glass-card rounded-xl p-4">
                              <BreakdownChart
                                data={result.breakdown.map(
                                  (r) => ({
                                    name: r.name.replace(
                                      / \\(.+\\)/,
                                      ""
                                    ),
                                    amount:
                                      r.amount_inr,
                                  })
                                )}
                              />
                            </div>
                          )}

                          {/* Detailed table */}

                          <div className="glass-card overflow-hidden rounded-xl p-3 sm:p-4">
                            <CostBreakdownTable
                              rows={result.breakdown}
                              contributions={
                                result.contributions
                              }
                              showContribution={
                                showContribution
                              }
                            />
                          </div>
                        </div>
                      )}

                      {/* ================================================= */}
                      {/* CONFIGURATION */}
                      {/* ================================================= */}

                      {activeResultTab ===
                        "configuration" && (
                        <div className="mt-5 glass-card rounded-xl p-4">
                          <ConfigurationTab
                            truckId={
                              result.meta.truck
                                ?.truck_id ?? ""
                            }
                            modelId={
                              result.meta.truck?.model_id
                            }
                            overrides={configOverrides}
                            excludedHeads={
                              excludedHeads
                            }
                            onChange={(
                              nextOverrides,
                              nextExcluded
                            ) => {
                              setConfigOverrides(
                                nextOverrides
                              );

                              setExcludedHeads(
                                nextExcluded
                              );
                            }}
                          />
                        </div>
                      )}

                      {/* ================================================= */}
                      {/* ROUTE MAP */}
                      {/* ================================================= */}

                      {activeResultTab === "route" && (
                        <div className="mt-5 overflow-hidden rounded-xl border border-white/60 bg-white/40 p-2 backdrop-blur-md">
                          <RouteMap
                            origin={result.meta.origin}
                            destination={
                              result.meta.destination
                            }
                          />
                        </div>
                      )}

                      {/* Bottom actions */}

                      <div
                        className="mt-6 flex items-center justify-between border-t border-white/30 pt-4"
                        data-print="hide"
                      >
                        <button
                          onClick={() => {
                            setResult(null);
                            setFormMinimized(false);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 transition-colors hover:text-slate-950"
                        >
                          ← Clear breakdown
                        </button>

                        <button
                          onClick={downloadMethodology}
                          className="rounded-xl border border-white/70 bg-white/75 px-4 py-2 text-xs font-bold text-blue-950 shadow-md transition-all hover:bg-white"
                        >
                          Export rate summary
                        </button>
                      </div>
                    </div>
                  </div>
                )}
            </section>
          </div>
        </div>

        {/* ========================================================= */}
        {/* PROVENANCE DRAWER */}
        {/* ========================================================= */}

        <ProvenanceDrawer
          open={provenanceResult !== null}
          onClose={() => setProvenanceResult(null)}
          result={provenanceResult}
        />
    
    <footer className="mt-12 border-t border-black/10 py-6">
  <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-2 px-6 text-center">
    <p className="text-sm font-medium text-slate-700">
      © {new Date().getFullYear()} PriceMyTrip
    </p>

    <p className="text-xs text-slate-600">
      All rights reserved
      <span className="mx-2 text-slate-400">•</span>
      Technical Partner:
      <span className="ml-1 font-semibold text-slate-700">
        Kodax Technologies
      </span>
    </p>
  </div>
</footer>
      </main>
    </>
  );
}

