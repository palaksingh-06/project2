import { readFileSync, writeFileSync } from "fs";

const SRC = new URL("../config/truck-models.json", import.meta.url);
const raw = JSON.parse(readFileSync(SRC, "utf8").replace(/^﻿/, ""));

// Ex-showroom price estimate, scaled by payload capacity — same formula
// Phase P0 used for category-level defaults (scripts/migrate-truck-rates.mjs).
// This is a PLACEHOLDER — Task 5/6 replaces every one of these with a
// real researched price and marks the source "real" or "proxy".
function estimateExShowroom(payloadTons) {
  return Math.round((300000 + payloadTons * 140000) / 1000) * 1000;
}

const newModels = {};
for (const [id, m] of Object.entries(raw.models)) {
  newModels[id] = {
    label: m.label,
    truck_class: m.truck_class,
    payload_tons: m.payload_tons,
    image: null, // filled in by Task 4
    mileage_kmpl: { value: m.mileage_kmpl, source: "estimate" }, // Task 5 upgrades to "real" where sourced
    ex_showroom_inr: { value: estimateExShowroom(m.payload_tons), source: "estimate" }, // Task 5 replaces
  };
}

writeFileSync(SRC, JSON.stringify({ models: newModels }, null, 2) + "\n");
console.log(`Migrated ${Object.keys(newModels).length} models to the enriched schema`);
