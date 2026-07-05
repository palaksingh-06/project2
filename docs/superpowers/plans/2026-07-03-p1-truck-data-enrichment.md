# Phase P1 — Truck Data Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich `config/truck-models.json` so every truck category has at least one real, named model with sourced mileage + ex-showroom price data, wire that data into the cost engine so picking a specific model actually changes the numbers (not just cosmetically), add a cropped image per model, and show that image in the UI.

**Architecture:** `config/truck-models.json` gains a richer per-model schema (mileage + price wrapped with `source` labels: `"real" | "proxy" | "estimate"`, plus an `image` path). A new shared helper derives insurance/interest from a model's ex-showroom price using the exact same formulas Phase P0's migration script already used for category-level defaults — this means only two facts need researching per model (mileage, price), not five. Both single-trip and multi-stop orchestration files pass the model's price into the calculator as an override, so insurance/interest/depreciation all shift correctly when a specific model is picked. Images are cropped once from `data/truck_images.jpg` into `public/truck-images/` via a `sharp`-based script and served as static assets.

**Tech Stack:** TypeScript, Next.js static assets (`public/`), `sharp` (already a dependency), Vitest.

## Global Constraints

- Never commit without explicit user permission (CLAUDE.md) — this plan assumes commits are pre-authorized per-task the same way Phase P0's execution was (confirm with the user before starting if that authorization has lapsed).
- Match existing code style/patterns; don't refactor adjacent code beyond what this phase requires.
- `npx tsc --noEmit` and `npx vitest run` must both be clean at the end of every task that touches shared types.
- Every researched numeric value (mileage, price) must carry an honest `source` label — `"real"` only if a genuine published spec/price was found, `"proxy"` if derived from a closely related real figure, `"estimate"` only as a last resort. Do not label a guessed number `"real"`.
- Full model list already in `config/truck-models.json` (75 entries) must be preserved — do not delete or rename existing model IDs, only add fields to them.
- The 26 categories with zero named models (listed in Task 6) must each get at least one new named model.

---

### Task 1: Extend the TruckModelEntry schema and migrate existing data

**Files:**
- Modify: `config/truck-models.json` (wrap `mileage_kmpl` in `{value, source}`, add `ex_showroom_inr: {value, source}` placeholder, add `image` placeholder to all 75 existing entries)
- Modify: `lib/config.ts` (update `TruckModel` interface and `getTruckModel`/`getTruckModels` return type)
- Create: `scripts/migrate-truck-models-schema.mjs` (one-off migration script, same spirit as Phase P0's `scripts/migrate-truck-rates.mjs`)
- Test: `lib/config.test.ts` (add cases for the new shape)

**Interfaces:**
- Produces: `TruckModel` interface with `mileage_kmpl: {value: number; source: "real"|"proxy"|"estimate"}`, `ex_showroom_inr: {value: number; source: "real"|"proxy"|"estimate"}`, `image?: string`, plus the existing `label`, `truck_class`, `payload_tons`. Consumed by Task 3 (wiring), Task 5/6 (data population), Task 7 (UI), and `components/TripForm.tsx` (existing consumer — its `modelOptions` mapping reads `m.mileage_kmpl` and must be updated to `m.mileage_kmpl.value`).

- [ ] **Step 1: Write the failing test**

Add to `lib/config.test.ts` (create the file if the interface below doesn't already exist there — Phase P0 added `getZbcGuidelines`/`getTerrainDepreciationMultiplier` tests to this same file, so append alongside them):

```typescript
import { getTruckModel, getTruckModels } from "@/lib/config";

describe("getTruckModel (enriched schema)", () => {
  it("returns mileage_kmpl and ex_showroom_inr as {value, source} objects", () => {
    const m = getTruckModel("tata-ace-mega");
    expect(m).not.toBeNull();
    expect(typeof m!.mileage_kmpl.value).toBe("number");
    expect(["real", "proxy", "estimate"]).toContain(m!.mileage_kmpl.source);
    expect(typeof m!.ex_showroom_inr.value).toBe("number");
    expect(["real", "proxy", "estimate"]).toContain(m!.ex_showroom_inr.source);
  });

  it("every model in the config has the enriched shape", () => {
    const models = getTruckModels();
    for (const [id, m] of Object.entries(models)) {
      expect(typeof m.mileage_kmpl.value, `${id}.mileage_kmpl.value`).toBe("number");
      expect(typeof m.ex_showroom_inr.value, `${id}.ex_showroom_inr.value`).toBe("number");
      expect(m.mileage_kmpl.value, `${id}.mileage_kmpl.value should be positive`).toBeGreaterThan(0);
      expect(m.ex_showroom_inr.value, `${id}.ex_showroom_inr.value should be positive`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/config.test.ts`
Expected: FAIL — `m!.mileage_kmpl.value` is `undefined` (current schema has `mileage_kmpl` as a bare number).

- [ ] **Step 3: Write the migration script**

Create `scripts/migrate-truck-models-schema.mjs`:

```javascript
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
```

- [ ] **Step 4: Run the migration script**

```bash
node scripts/migrate-truck-models-schema.mjs
```

Expected output: `Migrated 75 models to the enriched schema`

- [ ] **Step 5: Update the TruckModel interface in lib/config.ts**

Find the existing `TruckModel` interface in `lib/config.ts`:

```typescript
export interface TruckModel {
  label: string;
  truck_class: string;
  mileage_kmpl: number;
  payload_tons: number;
}
```

Replace it with:

```typescript
export interface SourcedValue {
  value: number;
  source: "real" | "proxy" | "estimate";
}

export interface TruckModel {
  label: string;
  truck_class: string;
  payload_tons: number;
  image: string | null;
  mileage_kmpl: SourcedValue;
  ex_showroom_inr: SourcedValue;
}
```

`getTruckModels()` and `getTruckModel()` in the same file need no signature change — they already return `Record<string, TruckModel>` / `TruckModel | null`; only the shape of `TruckModel` itself changed.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/config.test.ts`
Expected: PASS (all cases, including the new ones)

- [ ] **Step 7: Fix the now-broken consumer in components/TripForm.tsx**

This file reads `m.mileage_kmpl` directly (bare number) in its `modelOptions` `useMemo` — this will now be a type error since `mileage_kmpl` is `SourcedValue`. Find:

```typescript
  const modelOptions = useMemo(() => {
    if (!matchedTruck) return [];
    return Object.entries(allModels)
      .filter(([, m]) => m.truck_class === matchedTruck.id)
      .map(([id, m]) => ({ id, label: m.label, mileage_kmpl: m.mileage_kmpl }));
  }, [matchedTruck, allModels]);
```

Replace the last line with:

```typescript
      .map(([id, m]) => ({ id, label: m.label, mileage_kmpl: m.mileage_kmpl.value, image: m.image }));
```

- [ ] **Step 8: Run the full type check**

Run: `npx tsc --noEmit`
Expected: errors only in `lib/zbc/run-calculation.ts` and `lib/newzbc/run-calculation.ts` (both read `model.mileage_kmpl` as a bare number to compute an override — this is expected, fixed in Task 3). No errors anywhere else.

- [ ] **Step 9: Commit**

```bash
git add config/truck-models.json lib/config.ts lib/config.test.ts scripts/migrate-truck-models-schema.mjs components/TripForm.tsx
git commit -m "feat(zbc): extend TruckModel schema with source-labeled mileage/price + image field"
```

---

### Task 2: Shared helper to derive insurance/interest from a model's ex-showroom price

**Files:**
- Create: `lib/zbc/truck-economics.ts`
- Test: `lib/zbc/truck-economics.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, same constants as `scripts/migrate-truck-rates.mjs`).
- Produces: `deriveDependentCosts(exShowroomInr: number): { insurance_per_year: number; interest_per_year: number }` — consumed by Task 3 (`lib/zbc/run-calculation.ts`, `lib/newzbc/run-calculation.ts`).

This avoids requiring insurance/interest to be separately researched per model — they're derived from the one real fact (price) using the same formulas Phase P0 already validated for category defaults.

- [ ] **Step 1: Write the failing test**

Create `lib/zbc/truck-economics.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deriveDependentCosts } from "@/lib/zbc/truck-economics";

describe("deriveDependentCosts", () => {
  it("matches the Phase P0 migration script's own output for a known truck", () => {
    // 16T_6W's migrated ex_showroom_inr is 2,540,000 (see config/truck-rates.json)
    // and its migration-script-derived interest_per_year is 123,767 (verified in
    // the P0 whole-branch review). insurance_per_year for that truck is 63,500
    // (2,540,000 * 0.025). Both must reproduce exactly from the same inputs.
    const result = deriveDependentCosts(2540000);
    expect(result.insurance_per_year).toBe(63500);
    expect(result.interest_per_year).toBe(123767);
  });

  it("scales insurance linearly with price", () => {
    const cheap = deriveDependentCosts(1000000);
    const expensive = deriveDependentCosts(2000000);
    expect(expensive.insurance_per_year).toBe(cheap.insurance_per_year * 2);
  });

  it("returns whole-rupee integers", () => {
    const result = deriveDependentCosts(1234567);
    expect(Number.isInteger(result.insurance_per_year)).toBe(true);
    expect(Number.isInteger(result.interest_per_year)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/zbc/truck-economics.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/zbc/truck-economics"` (module doesn't exist yet).

- [ ] **Step 3: Implement the helper**

Create `lib/zbc/truck-economics.ts`:

```typescript
// Derives insurance and interest cost from a truck's ex-showroom price, using
// the exact same constants and amortization method as
// scripts/migrate-truck-rates.mjs used to compute these for category-level
// defaults in Phase P0. Kept in sync deliberately: a model's price is the one
// fact that's worth individually researching (Task 5/6); insurance and
// interest are mechanically dependent on it, not separate research targets.
const INSURANCE_RATE = 0.025;
const LOAN_PCT = 0.8;
const INTEREST_RATE = 0.11;
const LOAN_TERM_MONTHS = 60;

// Replicates the Unnati Excel's month-by-month declining-balance interest
// extraction: PMT formula for the fixed monthly payment, then subtract
// interest from each month's balance and sum the interest portion across the
// full term, averaged to an annual figure.
function computeAnnualInterest(exShowroomInr: number): number {
  const principal = exShowroomInr * LOAN_PCT;
  const r = INTEREST_RATE / 12;
  const n = LOAN_TERM_MONTHS;
  const emi = (principal * r) / (1 - Math.pow(1 + r, -n));

  let balance = principal;
  let totalInterest = 0;
  for (let month = 1; month <= n; month++) {
    const interest = balance * r;
    const principalPaid = emi - interest;
    totalInterest += interest;
    balance -= principalPaid;
  }
  return Math.round(totalInterest / (n / 12));
}

export function deriveDependentCosts(exShowroomInr: number): {
  insurance_per_year: number;
  interest_per_year: number;
} {
  return {
    insurance_per_year: Math.round(exShowroomInr * INSURANCE_RATE),
    interest_per_year: computeAnnualInterest(exShowroomInr),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/zbc/truck-economics.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/zbc/truck-economics.ts lib/zbc/truck-economics.test.ts
git commit -m "feat(zbc): derive per-model insurance/interest from ex-showroom price"
```

---

### Task 3: Wire model selection into the cost engine (both orchestration files)

**Files:**
- Modify: `lib/zbc/run-calculation.ts`
- Modify: `lib/newzbc/run-calculation.ts`

**Interfaces:**
- Consumes: `TruckModel` (Task 1), `deriveDependentCosts` (Task 2).
- Produces: no new interfaces — both files' `runCalculation()` signatures are unchanged; this task only changes what's inside the `rateOverrides` object built from a selected model.

- [ ] **Step 1: Update lib/zbc/run-calculation.ts**

Add the import:

```typescript
import { deriveDependentCosts } from "@/lib/zbc/truck-economics";
```

Find the existing model-resolution block:

```typescript
  const model = modelId ? getTruckModel(modelId) : null;
  const rateOverrides: RateOverrides | undefined = model
    ? { mileage_kmpl: Math.round(model.mileage_kmpl * 0.7 * 100) / 100, ...overrides }
    : (overrides as RateOverrides | undefined);
```

Replace with:

```typescript
  const model = modelId ? getTruckModel(modelId) : null;
  const rateOverrides: RateOverrides | undefined = model
    ? {
        mileage_kmpl: Math.round(model.mileage_kmpl.value * 0.7 * 100) / 100,
        ex_showroom_inr: model.ex_showroom_inr.value,
        ...deriveDependentCosts(model.ex_showroom_inr.value),
        ...overrides,
      }
    : (overrides as RateOverrides | undefined);
```

> `...overrides` stays last so an explicit user override (e.g. from the advanced-rates form) still wins over the model-derived defaults — same precedence Phase P0 already established for `mileage_kmpl`.

- [ ] **Step 2: Update lib/newzbc/run-calculation.ts identically**

Add the same import and apply the identical replacement to the equivalent block in this file (multi-stop orchestrator — same variable names `model`, `rateOverrides`, `overrides`, confirmed identical in Phase P0's Task 9/10 wiring of this same code region).

- [ ] **Step 3: Run the full type check**

Run: `npx tsc --noEmit`
Expected: zero errors, entire repository (this closes out the two errors flagged at the end of Task 1).

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests passing (should still be 66+ — the 63 from Phase P0 plus the new tests from Tasks 1-2 of this plan).

- [ ] **Step 5: Manually verify a model changes the total**

Start the dev server (`npm run dev`), pick a truck category with 2+ models in its dropdown (e.g. `16T_6W` has 5: Tata LPT 1613, Ashok Leyland 1616, Tata LPT 1815, BharatBenz 1617R, MAN CLA 16.220), calculate the same trip with two different models selected, and confirm the total differs (since Task 5/6 hasn't run real prices yet, the difference will reflect the estimate-only placeholder prices from Task 1's migration — that's fine, it proves the wiring works; Task 5/6 makes the numbers real).

- [ ] **Step 6: Commit**

```bash
git add lib/zbc/run-calculation.ts lib/newzbc/run-calculation.ts
git commit -m "feat(zbc): wire model-specific price into insurance/interest/depreciation"
```

---

### Task 4: Image crop pipeline

**Files:**
- Create: `scripts/crop-truck-images.mjs`
- Create: `public/truck-images/` (directory tree, one subfolder per `truck_class`)
- Modify: `config/truck-models.json` (fill in the `image` field for every model this task successfully crops)

**Interfaces:**
- Produces: static files at `public/truck-images/<truck_class>/<model-id>.png`, referenced by the `image` field on each `TruckModel` entry (Task 1's schema). Consumed by Task 7 (UI).

`data/truck_images.jpg` is a single sheet with ~9 labeled category bands, each containing 2-6 named-model photos in a row. There is no reliable OCR/metadata shortcut — this task requires **visually inspecting the image** (via the Read tool, which renders images) to determine each photo's bounding box, then cropping with `sharp`.

- [ ] **Step 1: Inspect the source image and record its dimensions**

```bash
node -e "const sharp = require('sharp'); sharp('data/truck_images.jpg').metadata().then(m => console.log(m.width, m.height));"
```

Note the width/height — you'll need them to compute crop boxes as fractions of the image, since band heights aren't perfectly uniform.

- [ ] **Step 2: View the image and map out band positions**

Read `data/truck_images.jpg` with the Read tool (it renders as an image). The sheet is laid out in this row order, top to bottom (confirmed during Phase P0/PRD brainstorming — verify it still matches what you see, image sheets don't change but re-confirm before trusting old notes):

1. MINI OPEN (up to 1.3 ton) — 5 photos | MINI CLOSED/VAN (up to 1 ton) — 2 photos
2. LCV OPEN (1.5–5 ton) — 5 photos | LCV CLOSED (5 ton) — 3 photos
3. 9–9.5 TON (4 wheel) — 3 photos | 16–17 FEET OPEN (9–9.5 ton) — 5 photos
4. 16–17 FEET CLOSED (10–11 ton) — 3 photos | 16 TON (6 wheel) — 5 photos | 20 FEET CLOSED (9.75–11 ton) — 4 photos
5. 25 TON (10 wheel) — 7 photos | 24 FEET CLOSED (16–21 ton) — 4 photos
6. 32 TON (12 wheel) — 6 photos | 32 FEET CLOSED (20–30 ton) — 4 photos | 40 FEET OPEN (35 ton) — 4 photos
7. 40 FEET CLOSED/CONTAINER (30–35 ton) — 4 photos | SPECIAL CATEGORY/LIGHT COMMERCIAL — 7 photos

For each photo, record approximate `{ x, y, width, height }` in pixels (or as fractions of total width/height, then multiply by the dimensions from Step 1). Write these to a JSON file `scripts/truck-image-crops.json` keyed by `model-id` (matching the IDs already in `config/truck-models.json`) — e.g.:

```json
{
  "tata-ace-mega": { "x": 12, "y": 20, "width": 140, "height": 110 },
  "tata-ace-gold": { "x": 160, "y": 20, "width": 140, "height": 110 }
}
```

You do not need a crop entry for every one of the 75 existing models on the first pass — only the ones whose photo you can clearly identify in the sheet. Models without a clear photo match get `image: null` (already the Task 1 default) and are a documented gap, not a blocker.

- [ ] **Step 3: Write the crop script**

Create `scripts/crop-truck-images.mjs`:

```javascript
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const crops = JSON.parse(readFileSync("scripts/truck-image-crops.json", "utf8"));
const modelsPath = new URL("../config/truck-models.json", import.meta.url);
const models = JSON.parse(readFileSync(modelsPath, "utf8").replace(/^﻿/, ""));

let cropped = 0;
for (const [modelId, box] of Object.entries(crops)) {
  const model = models.models[modelId];
  if (!model) {
    console.warn(`Skipping ${modelId}: not found in config/truck-models.json`);
    continue;
  }
  const outDir = path.join("public", "truck-images", model.truck_class);
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${modelId}.png`);

  await sharp("data/truck_images.jpg")
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .toFile(outPath);

  model.image = `/truck-images/${model.truck_class}/${modelId}.png`;
  cropped++;
}

writeFileSync(modelsPath, JSON.stringify(models, null, 2) + "\n");
console.log(`Cropped ${cropped} images; updated config/truck-models.json`);
```

- [ ] **Step 4: Run the crop script**

```bash
node scripts/crop-truck-images.mjs
```

Expected: `Cropped N images; updated config/truck-models.json` where N is however many entries you mapped in Step 2.

- [ ] **Step 5: Spot-check a few crops**

Use the Read tool on 3-4 of the generated PNGs at `public/truck-images/<class>/<model-id>.png` to confirm they show the correct truck, not a neighboring one or a cut-off/blank crop. Adjust `scripts/truck-image-crops.json` and re-run Step 4 for any that are wrong.

- [ ] **Step 6: Commit**

```bash
git add scripts/crop-truck-images.mjs scripts/truck-image-crops.json config/truck-models.json public/truck-images/
git commit -m "feat(zbc): crop per-model truck images from the reference sheet"
```

---

### Task 5: Research real mileage + price for the 75 existing models

**Files:**
- Modify: `config/truck-models.json` (replace placeholder `mileage_kmpl`/`ex_showroom_inr` values with researched ones, upgrading `source` from `"estimate"` to `"real"` or `"proxy"` wherever a genuine figure is found)
- Create: `docs/superpowers/specs/2026-07-03-p1-model-research-notes.md` (source URLs / reasoning per model, so the labeling is auditable later)

**Interfaces:**
- Consumes: `TruckModel` schema (Task 1).
- Produces: updated `config/truck-models.json` data only — no code interface changes.

This is a research task, not a code-transcription task: use WebSearch to find each model's real ARAI/manufacturer-claimed mileage and real ex-showroom price (India). Work through the 75 models grouped by category (same grouping as `config/truck-models.json`'s existing `truck_class` values). For each model:

1. Search for `"<model label>" mileage kmpl India` and `"<model label>" on road price India` (or ex-showroom price).
2. If a real figure is found: set `source: "real"`, record the URL in the research notes file.
3. If no exact model figure exists but a close sibling variant's spec is a reasonable stand-in: set `source: "proxy"`, note which sibling and why.
4. If nothing usable is found: leave the Task 1 placeholder value but change nothing else — it stays `source: "estimate"` (already the default), which is honest.

- [ ] **Step 1: Write the schema-validation test first**

Add to `lib/config.test.ts` (append to the `getTruckModel (enriched schema)` describe block from Task 1):

```typescript
  it("real/proxy sources are only claimed with a note in the research log", () => {
    const models = getTruckModels();
    const realOrProxyCount = Object.values(models).filter(
      (m) => m.mileage_kmpl.source !== "estimate" || m.ex_showroom_inr.source !== "estimate"
    ).length;
    // At least half the catalog should have moved past pure estimates once
    // research is done — this is a coarse regression guard, not a precise
    // target: it catches "the whole file silently reverted to all-estimate"
    // without dictating exactly how many models must be real.
    expect(realOrProxyCount).toBeGreaterThan(Object.keys(models).length / 2);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/config.test.ts`
Expected: FAIL (immediately after Task 1's migration, every model is still `source: "estimate"`).

- [ ] **Step 3: Research and update each model**

Create `docs/superpowers/specs/2026-07-03-p1-model-research-notes.md` and, for each of the 75 models (grouped by `truck_class` — use the list already in `config/truck-models.json` as your worklist), add an entry like:

```markdown
## tata-ace-mega (Tata Ace Mega)
- Mileage: 15.2 kmpl (source: real) — https://example.com/tata-ace-mega-specs
- Ex-showroom: ₹4,58,000 (source: real) — https://example.com/tata-ace-mega-price
```

After researching each model, update its entry in `config/truck-models.json` directly (both the `value` and `source` fields).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/config.test.ts`
Expected: PASS once more than half the catalog has moved past `"estimate"`.

- [ ] **Step 5: Run the full suite and type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add config/truck-models.json docs/superpowers/specs/2026-07-03-p1-model-research-notes.md
git commit -m "feat(zbc): research real mileage/price for existing truck model catalog"
```

---

### Task 6: Add a named model for each of the 26 uncovered categories

**Files:**
- Modify: `config/truck-models.json` (add 26 new model entries)
- Modify: `docs/superpowers/specs/2026-07-03-p1-model-research-notes.md` (append research notes for the new models)

**Interfaces:**
- Consumes: `TruckModel` schema (Task 1).
- Produces: updated `config/truck-models.json` data only.

These 26 `truck_class` values in `config/truck-rates.json` currently have **zero** models in `config/truck-models.json`, so users picking these categories never see a model dropdown at all. Add at least one real, named model to each:

| truck_class | Category spec |
|---|---|
| `10ft_2T_open` | 2T · 10ft · 2-Axle · Open |
| `14ft_4T_open` | 4T · 14ft · 2-Axle · Open |
| `17ft_5T_open` | 5T · 17ft · 2-Axle · Open |
| `19ft_10T_open` | 10T · 19ft · 2-Axle · Open |
| `22ft_10T_open` | 10T · 22ft · 2-Axle · Open |
| `22ft_18T_open` | 18T · 22ft · 3-Axle · Open |
| `25ft_25T_open` | 25T · 25ft · 4-Axle · Open |
| `28ft_30T_open` | 30T · 28ft · 5-Axle · Open |
| `30ft_30T_open` | 30T · 30ft · 5-Axle · Open |
| `half_daala` | 9T · 32ft · 2-Axle · Open |
| `10ft_2T_closed` | 2T · 10ft · 2-Axle · Closed/Container |
| `14ft_3_5T_closed` | 3.5T · 14ft · 2-Axle · Closed/Container |
| `19ft_6T_closed` | 6T · 19ft · 2-Axle · Closed/Container |
| `20ft_6_5T_closed` | 6.5T · 20ft · 2-Axle · Closed/Container |
| `32ft_9T_closed` | 9T · 32ft · 2-Axle · Closed/Container |
| `32ft_18T_closed` | 18T · 32ft · 3-Axle · Closed/Container |
| `15T_20ft_open` | 15T · 20ft · 2-Axle · Open |
| `15T_20ft_closed` | 15T · 20ft · 2-Axle · Closed |
| `20T_24ft_open` | 20T · 24ft · 3-Axle · Open |
| `20T_24ft_closed` | 20T · 24ft · 3-Axle · Closed |
| `21T_24ft_open` | 21T · 24ft · 3-Axle · Open |
| `21T_24ft_closed` | 21T · 24ft · 3-Axle · Closed |
| `24T_24ft_open` | 24T · 24ft · 3-Axle · Open |
| `24T_24ft_closed` | 24T · 24ft · 3-Axle · Closed |
| `27T_32ft_open` | 27T · 32ft · 4-Axle · Open |
| `27T_32ft_closed` | 27T · 32ft · 4-Axle · Closed |

- [ ] **Step 1: Write the failing test**

Add to `lib/config.test.ts`:

```typescript
describe("getTruckModels covers every truck-rates.json category", () => {
  it("has at least one model for every truck category", () => {
    // Requires importing getTruckRatesConfig alongside getTruckModels at the
    // top of this test file if not already imported.
    const rates = getTruckRatesConfig();
    const models = getTruckModels();
    const coveredClasses = new Set(Object.values(models).map((m) => m.truck_class));
    const uncovered = Object.keys(rates.trucks).filter((id) => !coveredClasses.has(id));
    expect(uncovered, `Categories with no named model: ${uncovered.join(", ")}`).toEqual([]);
  });
});
```

(Add `getTruckRatesConfig` to this test file's import from `@/lib/config` if it isn't already imported there.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/config.test.ts`
Expected: FAIL, listing the 26 uncovered categories from the table above.

- [ ] **Step 3: Research and add one model per gap category**

For each of the 26 categories in the table, use WebSearch to find one real, currently-sold Indian commercial truck matching that tonnage/length/axle/body-type spec (e.g. a Tata, Ashok Leyland, Eicher, BharatBenz, or Mahindra model in that class). Add a new entry to `config/truck-models.json` following the Task 1 schema:

```json
"tata-<model-slug>": {
  "label": "Tata <Real Model Name>",
  "truck_class": "14ft_4T_open",
  "payload_tons": 4,
  "image": null,
  "mileage_kmpl": { "value": 9.5, "source": "real" },
  "ex_showroom_inr": { "value": 1150000, "source": "real" }
}
```

Append research notes for each to `docs/superpowers/specs/2026-07-03-p1-model-research-notes.md` (same format as Task 5). If a genuinely matching real model can't be found for a given spec, use the closest real sibling and mark it `"proxy"` with a note explaining the substitution — every category must end up with at least one entry, but not every entry must be a perfect spec match.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/config.test.ts`
Expected: PASS — zero uncovered categories.

- [ ] **Step 5: Run the full suite and type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add config/truck-models.json docs/superpowers/specs/2026-07-03-p1-model-research-notes.md
git commit -m "feat(zbc): add a named model for every previously-uncovered truck category"
```

---

### Task 7: Show the model image in the UI

**Files:**
- Modify: `components/TripForm.tsx`

**Interfaces:**
- Consumes: `modelOptions[].image` (already added in Task 1, Step 7).
- Produces: no new interfaces — this is leaf UI, minimal by design (the full tabbed Configuration-tab redesign with a larger image display is Phase P2's job).

- [ ] **Step 1: Add an image preview next to the model dropdown**

Find the "Optional model selector" block in `components/TripForm.tsx` (near line 291, right after `{modelOptions.length > 0 && (`). After the closing `</select>` for the model dropdown, add:

```tsx
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
```

- [ ] **Step 2: Run the type check**

Run: `npx tsc --noEmit 2>&1 | grep "TripForm.tsx"`
Expected: no output.

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

Open the app, select a truck category that has a model with a successfully-cropped image (Task 4), pick that model from the dropdown, and confirm the image renders below the dropdown. Select a model with `image: null` and confirm nothing breaks (no broken-image icon — the conditional in Step 1 should render nothing).

- [ ] **Step 4: Commit**

```bash
git add components/TripForm.tsx
git commit -m "feat(zbc): show truck model image on selection"
```

---

### Task 8: Full verification

**Files:**
- No new source files. Verification only.

- [ ] **Step 1: Run the full type check**

Run: `npx tsc --noEmit`
Expected: zero errors, entire repository.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests passing.

- [ ] **Step 3: Browser-verify a model actually changes the total**

```bash
npm run dev
```

Pick a truck category with 2+ researched models (real, not placeholder, prices — confirm via `config/truck-models.json`), calculate the same trip with each model selected, and confirm the totals differ meaningfully (not just by the tiny mileage-only delta from before Task 5/6 landed) — the insurance/interest/depreciation lines in the breakdown should visibly change based on the model's real price.

- [ ] **Step 4: Confirm image coverage**

```bash
node -e "
const m = require('./config/truck-models.json').models;
const withImage = Object.values(m).filter(x => x.image).length;
console.log(\`\${withImage} / \${Object.keys(m).length} models have an image\`);
"
```

Report the coverage number — 100% is not required (Task 4 explicitly allows gaps for unclear photo matches), but note it for the user.

- [ ] **Step 5: Confirm every truck category now has at least one model**

```bash
node -e "
const rates = require('./config/truck-rates.json').trucks;
const models = require('./config/truck-models.json').models;
const classes = new Set(Object.values(models).map(m => m.truck_class));
const uncovered = Object.keys(rates).filter(k => !classes.has(k));
console.log('Uncovered categories:', uncovered.length === 0 ? 'none' : uncovered.join(', '));
"
```

Expected: `Uncovered categories: none`.

---

## Summary of what P1 does NOT include (explicitly deferred)

- Tabbed UI layout, Configuration tab with checkboxes, "Add more components" panel (Phase P2).
- Cost Breakdown tab redesign with source-on-top display (Phase P3).
- Route Map tab / route optimization (Phase P4).
- Batch on-demand route alternatives (Phase P5).
- Return-load probability tuning against real freight data (Phase P6).
- Itemized maintenance sub-components (oils, filters, coolant) and tyre retreading modeling — these were flagged in the Unnati analysis as enhancements but never locked in as a decision; still out of scope.
