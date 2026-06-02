"use client";

import { useRef, useState } from "react";
import { parseBatchCsv, MAX_BATCH_ROWS } from "@/lib/csv/parse-batch";
import type { ValidatedRow, RowError } from "@/lib/csv/parse-batch";
import type { BatchRowResult } from "@/lib/export/excel";

interface BatchUploadProps {
  onResults: (results: BatchRowResult[]) => void;
}

// Renders the per-row, per-field validation error table
function ValidationErrorTable({ errors }: { errors: RowError[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-red-200 bg-red-50">
      <p className="px-4 pt-3 text-sm font-medium text-red-700">
        {errors[0]?.rowNum === 0
          ? "File error"
          : `${errors.length} row${errors.length > 1 ? "s" : ""} have validation errors — fix and re-upload`}
      </p>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="border-b border-red-200 text-left text-red-500">
            <th className="px-4 pb-2 font-medium">Row</th>
            <th className="px-4 pb-2 font-medium">Column</th>
            <th className="px-4 pb-2 font-medium">Issue</th>
          </tr>
        </thead>
        <tbody>
          {errors.flatMap((e) =>
            e.fields.map((f, fi) => (
              <tr key={`${e.rowNum}-${fi}`} className="border-b border-red-100 last:border-0">
                <td className="px-4 py-1.5 text-red-700">{e.rowNum === 0 ? "—" : e.rowNum}</td>
                <td className="px-4 py-1.5 font-mono text-red-600">{f.column}</td>
                <td className="px-4 py-1.5 text-red-700">{f.message}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function BatchUpload({ onResults }: BatchUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [validRows, setValidRows] = useState<ValidatedRow[]>([]);
  const [validationErrors, setValidationErrors] = useState<RowError[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [apiErrors, setApiErrors] = useState<Array<{ rowNum: number; error: string }>>([]);

  // Read file, run client-side CSV validation, update state
  function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      setValidationErrors([
        { rowNum: 0, fields: [{ column: "file", message: "Only .csv files are accepted" }] },
      ]);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows, errors } = parseBatchCsv(text);
      setValidRows(rows);
      setValidationErrors(errors);
      setApiErrors([]);
    };
    reader.readAsText(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  // Send validated rows to the batch API and hand results upward
  async function handleCalculate() {
    setCalculating(true);
    setApiErrors([]);
    try {
      const res = await fetch("/api/calculate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: validRows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setApiErrors([{ rowNum: 0, error: data.error ?? "Batch calculation failed" }]);
        return;
      }
      if (data.errors?.length) setApiErrors(data.errors);
      if (data.results?.length) onResults(data.results);
    } catch {
      setApiErrors([{ rowNum: 0, error: "Network error. Please try again." }]);
    } finally {
      setCalculating(false);
    }
  }

  const hasValidRows = validRows.length > 0;
  const hasErrors = validationErrors.length > 0;

  return (
    <div className="space-y-4">
      {/* Download template link */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Upload a CSV with one trip per row (max {MAX_BATCH_ROWS} rows).
        </p>
        <a
          href="/api/csv-template"
          download="zbc-batch-template.csv"
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          Download template ↓
        </a>
      </div>

      {/* Drag-and-drop upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors ${
          isDragOver
            ? "border-brand-400 bg-brand-50"
            : "border-slate-300 bg-white hover:border-brand-300 hover:bg-slate-50"
        }`}
      >
        <svg className="mb-2 h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-sm font-medium text-slate-700">
          {isDragOver ? "Drop to upload" : "Click or drag CSV here"}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">.csv files only</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* Show validation errors if any */}
      {hasErrors && <ValidationErrorTable errors={validationErrors} />}

      {/* Show valid row count and calculate button */}
      {hasValidRows && !hasErrors && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-700">
            {validRows.length} trip{validRows.length > 1 ? "s" : ""} ready to calculate
          </p>
          <button
            onClick={handleCalculate}
            disabled={calculating}
            className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
          >
            {calculating ? "Calculating…" : `Calculate ${validRows.length} trip${validRows.length > 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      {/* Show per-row API errors after calculation */}
      {apiErrors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium mb-1">Some trips could not be calculated:</p>
          <ul className="space-y-1 list-disc list-inside">
            {apiErrors.map((e, i) => (
              <li key={i}>
                {e.rowNum > 0 ? `Row ${e.rowNum}: ` : ""}{e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
