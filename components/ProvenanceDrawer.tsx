"use client";

import { useEffect } from "react";
import { ProvenancePanel } from "@/components/ProvenancePanel";

// Minimal shared shape — passed from page.tsx as CalculateResponse or BatchRowResult
interface ProvenanceData {
  meta: {
    inputs?: {
      geocode_origin?: { kind: string; label: string; detail?: string; updated_at?: string };
      geocode_origin_name?: { kind: string; label: string; detail?: string };
      geocode_destination?: { kind: string; label: string; detail?: string; updated_at?: string };
      geocode_destination_name?: { kind: string; label: string; detail?: string };
      distance?: { kind: string; label: string; detail?: string };
      fuel?: { kind: string; label: string; detail?: string; updated_at?: string };
      toll?: { kind: string; label: string; detail?: string };
    };
    cost_heads?: Record<string, { kind: string; label: string; detail?: string }>;
    truck?: {
      truck_id: string;
      truck_label: string;
      model_id?: string;
      model_label?: string;
      mileage_used: number;
      provenance: { kind: string; label: string };
    };
  };
}

interface ProvenanceDrawerProps {
  open: boolean;
  onClose: () => void;
  result: ProvenanceData | null;
}

export function ProvenanceDrawer({ open, onClose, result }: ProvenanceDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Don't render when there's no result to show
  if (!result) return null;

  return (
    <>
      {/* Semi-transparent backdrop — click anywhere to close */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
        />
      )}

      {/* Slide-in drawer panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-full bg-white shadow-xl z-50 flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Data sources</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5">
          <ProvenancePanel result={result} />
        </div>
      </div>
    </>
  );
}
