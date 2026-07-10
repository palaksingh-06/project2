# Project Handoff

## Current Objective

Ground-up refactor of the Zero-Based Costing (ZBC) freight calculator into an
explicit **Fixed + Variable + Margin** model with itemized, real-data-sourced
truck economics and a redesigned tabbed UI, per the PRD at
`docs/superpowers/specs/2026-07-02-zbc-refactor-prd.md`. Work happens entirely
on branch **`p0-zbc-model-refactor`** (checked out already), executed phase by
phase via the `superpowers:subagent-driven-development` skill — **no merge to
`main` until all phases are done** (explicit user instruction). Commit after
every phase, locally, to this same branch.

**Standing instruction from the user:** execute all remaining phases (P3-P6)
one by one, without stopping to ask — continuous execution. After every two
phases, update this file and hand off to a fresh session (this session ran
long — three phases — precisely because periodic handoffs hadn't started yet;
follow the two-phase cadence going forward).

## Current Status

- **Phases P0, P1, P2: COMPLETE.** All committed to `p0-zbc-model-refactor`.
  Each phase's whole-branch review passed (P2 needed three fix-and-re-review
  rounds — see "Important Decisions" below — but converged clean).
- `npx tsc --noEmit`: clean, whole repo.
- `npx vitest run`: **79/79 passing**.
- Branch NOT merged to `main`. Do not merge until the user explicitly asks
  (after all phases P0-P6 are done, per their instruction).

## Completed Since Last Session

### Phase P0 — ZBC Model Refactor (15 tasks)
Rewrote the cost engine from a 9-head, single-`risk_pct`-margin model to a
21-head Fixed+Variable+Margin model: driver/helper salary allocated by
trip-days; every other fixed cost (depreciation-aging, insurance, road tax,
fitness, interest) allocated via a new Unnati-style trip-duration/uptime/
annual-km utilization engine (`lib/zbc/utilization.ts`); depreciation split
into aging (fixed) + usage (variable, terrain-scaled); financing changed from
buggy EMI-double-counting to interest-only via real loan amortization;
overhead(7%)+profit(10%) replace the old flat `risk_pct`. Migrated
`config/truck-rates.json` (46 categories). Updated every downstream consumer
(validate.ts, provenance, Theobroma route cost-sharing, both orchestration
files, 3 API Zod schemas, CSV batch upload, UI override form/breakdown
panels, methodology export). Plan:
`docs/superpowers/plans/2026-07-02-p0-zbc-model-refactor.md`. Validation
numbers (old-vs-new delta, Unnati utilization sanity check) in
`docs/superpowers/specs/2026-07-02-unnati-excel-analysis.md`.

### Phase P1 — Truck Data Enrichment (8 tasks)
`config/truck-models.json`: 75 pre-existing named truck models enriched with
real/proxy/estimate-labeled mileage + ex-showroom price (66/75 moved past
pure estimate); 26 previously-uncovered truck categories (out of 46 total)
each got a new named model — **every category now has at least one named
model, zero gaps**. New `lib/zbc/truck-economics.ts::deriveDependentCosts()`
derives insurance/interest from a model's price using Phase P0's exact
amortization formula (so only mileage+price need individual research, not 5
fields). Both orchestration files wired so picking a specific model
genuinely changes the total (verified live: same route/category, two models
→ ₹26,650 vs ₹28,816). Image crop pipeline: 73/101 models have a photo
(`public/truck-images/`), shown in `TripForm.tsx` on model selection.
Research audit trail: `docs/superpowers/specs/2026-07-03-p1-model-research-notes.md`
(perfect 1:1 traceability, zero unsourced claims — independently verified).
Plan: `docs/superpowers/plans/2026-07-03-p1-truck-data-enrichment.md`.

### Phase P2 — UI Tabs + Configuration Tab (6 tasks)
- `lib/zbc/calculate.ts` gained `excluded_heads?: CostHeadId[]` — any of 15
  fixed/variable heads (not fuel/toll/loading/empty_return/overhead/profit,
  deliberately non-excludable) can be turned off; correctly propagates into
  the line array, the overhead/profit base, the subtotal, AND the
  empty-return backhaul blend (`backhaulVariablePerKm` — the subtle part).
- New `components/CostSourceBadge.tsx` — small real/proxy/estimate pill,
  deliberately separate from the existing cost-HEAD provenance system
  (`lib/zbc/provenance.ts`).
- New `components/ConfigurationTab.tsx` — the big one: pre-filled editable
  fields for every fixed/variable cost input, source badges, include/exclude
  checkboxes, collapsed "Add more components" section for off-by-default
  add-ons, editable return-load-probability, expandable truck-data reference
  table.
- `app/page.tsx`: three-tab bar (Configuration / Cost Breakdown / Route
  Map — Route Map is an intentional placeholder, Phase P4's job), form
  auto-minimizes on successful single-trip calculation (not batch), and a
  debounced live-recompute effect keeps the Cost Breakdown tab in sync as
  Configuration-tab fields change.
- `excluded_heads` had to be threaded through `CalculateRequest`, the
  `/api/newcalculate` Zod schema (with a `satisfies readonly CostHeadId[]`
  compile-time drift guard), `MultiStopCalculationRequest`, and
  `lib/newzbc/run-calculation.ts` — Task 1 only added it to the internal
  engine type, not the API layer; this was a necessary correction made
  during Task 5, not scope creep.
- Two documented, deliberate PRD deviations (see plan's Global Constraints):
  no `operating_days_per_month` field (Phase P0 already replaced that
  allocation method); return-load-probability pre-fills from the truck
  profile default, not a live destination lookup (component doesn't receive
  a destination).
- Plan: `docs/superpowers/plans/2026-07-03-p2-ui-tabs-configuration.md`.

## Important Decisions

- **P2's whole-branch review needed three fix-and-re-review rounds** — this
  is the one piece of this session most worth reading closely before
  touching `app/page.tsx` again:
  1. Review found: Configuration-tab state (`configOverrides`/
     `excludedHeads`) didn't reset on a fresh Calculate click → visual
     desync with the Cost Breakdown tab. **Fix:** reset both to `{}`/`[]`
     in `handleCalculate`'s non-silent branch (commit `964921b`).
  2. That fix's `setState({})`/`setState([])` always creates new references,
     which always re-triggers the live-recompute `useEffect` (React's
     dependency comparison is reference-based) → a spurious duplicate
     `/api/newcalculate` request fired on **every** Calculate click,
     racing the button's own request. **Fix:** a content-based guard —
     skip the effect if both states are empty (commit `7804882`).
  3. That guard over-corrected: it can't distinguish "empty because of a
     fresh-Calculate reset" (skip is correct) from "empty because the user
     just re-included a previously-excluded head / cleared an override"
     (a recompute IS needed) — so reverting an edit silently failed to
     recompute. **Fix:** replaced the content check with a
     `skipNextRecomputeRef` (`useRef`) set to `true` only inside the reset
     branch, consumed (read-then-cleared) by the effect — this correctly
     distinguishes "this transition came from a reset" from "this
     transition came from a user edit that happens to land on empty"
     (commit `e2f84ca`).
  All three fix rounds were independently live-browser-verified (request
  counts + actual line presence/absence, not just code review) before
  moving on. **Two known, non-blocking follow-ups** noted, not yet fixed:
  (a) no request cancellation/sequencing exists in `handleCalculate` — a
  narrow, pre-existing race (predates all three fixes above) where an
  in-flight silent recompute could theoretically resolve after a newer
  request with `setResult(data)` unconditionally overwriting; (b) no
  automated test covers this reset/skip/recompute interaction — it went
  through three rounds of live-manual-discovery specifically because
  nothing but browser testing was exercising it. A mocked-`fetch` test
  asserting call counts across (fresh calc / exclude / re-include) would
  have caught rounds 2 and 3 immediately and is a reasonable thing to add
  before touching this area again.
- Model selection for exclusion: fuel, toll, loading, empty_return,
  overhead, profit are deliberately non-excludable — attempting to exclude
  them is a silent no-op, not an error. Don't "fix" this.
- Phase P1's image crops have a known minor cosmetic issue (edge-bleed —
  a sliver of a neighboring photo visible in some crops) and 28/101 models
  have no photo (`image: null`) — both explicitly accepted, not bugs.

## Next Actions

Continue phase-by-phase per the plan's phase table
(`docs/superpowers/specs/2026-07-02-zbc-refactor-prd.md`, §11 or wherever
the phase table lives — search for "P3" in that file):

1. **Read this file first**, then re-read the phase table in the PRD.
2. **Brainstorm/plan Phase P3** (Cost Breakdown tab redesign: grouped
   Fixed/Variable/Margin view, source-on-top display without a click,
   derived metrics — freight per MT, per loaded km, etc.). Use
   `superpowers:writing-plans`, save to
   `docs/superpowers/plans/YYYY-MM-DD-p3-cost-breakdown-redesign.md`.
3. **Execute P3** via `superpowers:subagent-driven-development` — same
   pattern as P0/P1/P2: task-brief → dispatch implementer (commits
   pre-authorized, state this explicitly in every dispatch prompt) →
   independently verify (don't just trust agent self-reports — this
   session caught multiple agents claiming things that weren't true, and
   caught a 3-round regression chain specifically through independent
   live-browser verification, not by trusting reports) → dispatch task
   reviewer → fix loop if needed → next task. Final whole-branch review at
   the end of the phase, scoped to just that phase's diff (previous
   phases already reviewed clean — don't re-review them).
4. **Then Phase P4** (Route Map tab: TollGuru alternatives, `/api/routes`,
   Leaflet map, Map + Route Excel downloads).
5. **Update this file again after P4**, then hand off to a fresh session
   for P5 (batch parity: tabs + on-demand route alternatives) and P6
   (return-load tuning + validation against `data/fist200b4prob.xlsx`).
6. Only after P6 is done and reviewed: ask the user whether to merge to
   `main`, push a PR, or something else — do not merge unprompted.

## Open Issues

- The two P2 follow-ups above (request-sequencing gap, missing automated
  test for the reset/recompute interaction) — not blocking, but real.
- 28/101 truck models still have `image: null` (no cropped photo) — fine
  per Phase P1's explicit scope, but a future pass could improve coverage.
- 9/75 originally-enriched models in Phase P1 are still `source: "estimate"`
  on both mileage and price (no usable web data found) — also explicitly
  accepted, not a defect.
- A pre-existing React "missing key prop" console warning in
  `components/BatchResultsTable.tsx` (confirmed predates this branch,
  untouched by any phase so far) — cosmetic, not introduced by this work,
  not yet fixed.

## Modified Files

Every file touched across P0/P1/P2 is committed — see `git log
--oneline bd4a325..HEAD` for the full list (bd4a325 is where this branch
started, before P0). Do not rely on `git status` to find "recent work" —
everything is committed; `git status` will only show pre-existing,
unrelated stray files (`.gitignore`, `data/image.png` deletion,
`tsconfig.tsbuildinfo`, a few untracked data files) that predate this
branch and are not part of this refactor — leave them alone.

Progress ledger with every task's commit range and review outcome:
`.superpowers/sdd/progress.md` (git-ignored, local only — if it's ever
missing, `git log` is the source of truth, not memory).

## Useful Commands

- `npx vitest run` — run all tests (currently 79/79)
- `npx tsc --noEmit` — full-repo type check (currently clean)
- `npm run dev` — start dev server (port may not be 3000 if something
  else is running; check the printed URL)
- `git log --oneline bd4a325..HEAD` — full commit history of this refactor
- `cat .superpowers/sdd/progress.md` — task-by-task progress ledger

## Notes For Next Session

- Read `docs/superpowers/plans/2026-07-02-zbc-refactor-prd.md` in full
  before planning P3 — it has the exact requirements for the Cost
  Breakdown tab redesign (§7.3) and derived metrics (§5.4).
- The user wants continuous execution — don't stop to ask "should I
  continue?" between tasks or phases. Do stop and ask if genuinely
  blocked (ambiguous requirement, a real design decision only they can
  make) — this session asked two such questions during P1 planning
  (data-sourcing approach, gap-category coverage) and both were answered
  quickly; that's the right calibration.
- Independently verify subagent work before trusting it — this session
  caught: two hallucinated report files (P0), several false "unauthorized
  commit" security-flag false-positives (commits ARE pre-authorized — say
  so explicitly and clearly in every dispatch prompt), and the 3-round P2
  regression chain that only surfaced through live Playwright browser
  testing with request-count instrumentation, not code review alone. Live
  browser verification (via Playwright, `node` script + `chromium.launch()`
  — no `chromium-cli` available in this environment) caught real bugs that
  `tsc`/`vitest` alone did not.
