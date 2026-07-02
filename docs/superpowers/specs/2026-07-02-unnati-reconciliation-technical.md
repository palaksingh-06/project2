# ZBC Model Reconciliation — Technical Analysis

**Context:** The draft PRD (§5) proposed a cost model that diverges from the Unnati Excel in three material ways. This document analyzes each conflict — methodological foundations, accounting correctness, and impact on output.

---

## Conflict 1: Fixed-Cost Allocation — Annual-km Amortization vs. Days-Based Allocation

### Unnati Approach (Annual-km Amortization)

**Principle:** All fixed costs are expressed as per-km figures, amortized across the estimated annual distance traveled.

```
Fixed ₹/km = Σ (annual fixed components) / estimated_annual_km
```

**Estimated annual km derivation:**
1. **Trip duration (hours):** Deterministic from task times
   ```
   trip_hrs = placement (2h) + plant_turnaround (4h) + travel_time + client_turnaround (4h) 
              + return_to_garage (4h) + rest_required + return_load_wait (0 or 12h)
   travel_time = ROUNDUP(one_way_distance / avg_speed, 0)
   rest_required = IF(trip_hrs > 16, 8h, 0) — 8 hours per 16 worked
   ```

2. **Trips per month (accounting for uptime):**
   ```
   trips_per_month = ROUNDDOWN(30 days × 24 hrs / trip_hrs × 0.9 uptime, 0)
   ```
   The `0.9` (90% availability) accounts for scheduled maintenance, downtime, owner-operator
   rest, etc. — *structural* idle, not trip-by-trip variance.

3. **Annual km:**
   ```
   annual_km = trips_per_month × one_way_distance × 2 × 12 months
   ```
   Capped: if this exceeds an input-defined annual limit (e.g., from tire life or regulatory
   constraints), use the cap instead.

**Outcome:** A truck on a long-haul route (few trips, high km each) has lower trips/month but
higher km/trip → fixed cost ₹/km can be higher or lower than a truck on many short hauls,
depending on which effect dominates. **The utilization engine is agnostic to trip length** — it
bases everything on absolute time and uptime, not on arbitrarily-chosen trip counts.

**Accounting rationale:** Capital costs (depreciation, financed asset carrying cost) are best
amortized over the asset's productive capacity (km traveled), not arbitrary calendar divisions.
This is consistent with straight-line depreciation based on usage (km-based life), not time.

---

### Draft PRD Approach (Days-Based Allocation)

**Principle:** All fixed costs are expressed as monthly figures and allocated per trip by
calendar days.

```
Fixed ₹/trip = Σ (monthly fixed components) / operating_days_per_month × trip_days
```

**Parameters:**
- `operating_days_per_month`: default 30, user-editable to 25/28 to price in idle time.
- `trip_days`: duration of the trip, calculated as distance / avg_speed, rounded up.

**Outcome:** A 2-day trip always costs `(monthly fixed) / 30 × 2` regardless of whether it's
500 km or 1500 km. A user concerned about <5000 km/month utilization lowers `operating_days`
to (say) 22, which spreads fixed cost across fewer days → higher cost per trip.

**Model rationale (from PRD):** Simpler to explain and configure; users directly see the knob
(operating days divisor) that prices idle time. No need to model turnaround times or uptime %;
just a monthly budget split.

---

### Comparison: A Worked Example

**Truck:** Canter 6.5T (Unnati data)
- Annual fixed cost: ~₹4.4L (depreciation ₹1.75L + crew ₹1.74L + insurance ₹0.63L + interest ₹0.28L)
- One-way distance: 500 km
- Avg speed: 50 km/h
- Return-load probability: 80%

#### **Unnati (annual-km method):**

Trip duration:
```
travel = ROUNDUP(500 / 50, 0) = 10 hrs
placement + plant turnaround + client turnaround + return garage = 2+4+4+4 = 14 hrs
return load wait = 12 hrs (has 80% return)
subtotal = 10 + 14 + 12 = 36 hrs
rest for >16 hrs = 8 hrs
trip_total = 36 + 8 = 44 hrs ≈ 1.83 days
```

Trips per month (90% uptime):
```
trips = ROUNDDOWN(30 × 24 / 44 × 0.9, 0) = ROUNDDOWN(14.73, 0) = 14 trips/month
```

Annual km:
```
annual_km = 14 trips × 500 km × 2 × 12 = 168,000 km
```

Fixed ₹/km:
```
₹/km = 440,000 / 168,000 = ₹2.62/km per trip
```

Per-trip fixed cost (500 km round trip):
```
per_trip = ₹2.62/km × 500 km = ₹1,310
```

#### **Days-Based (30-day divisor):**

Trip days: 2 (as stipulated in PRD calculation method: 500 km ÷ 50 km/h ÷ 24 hr/day ≈ 0.42 days, round to 1 or 2)

Fixed cost per trip:
```
₹/trip = (440,000 / 12) / 30 × 2 = (36,667) / 30 × 2 = ₹2,444
```

#### **Result:**
- **Unnati:** ₹1,310 / trip (based on 14 trips/month, 168,000 km/year)
- **Days:** ₹2,444 / trip (assumes 30-day operating divisor, 2 calendar days)

**Delta:** The Unnati method is ~46% lower because it models realistic trip cadence (14 trips/month
over 44-hour cycles) whereas the days method charges 2/30 of monthly fixed regardless. **If you
lower the operating divisor to 22 days** (to account for idle):
```
₹/trip = (36,667 / 22) × 2 = ₹3,333
```
You'd overshoot in the opposite direction because the divisor conflates *idle days* with *trip days*.

---

### Which Is Correct?

**For consulting-grade ZBC:** Unnati's annual-km method is more rigorous. It:
- Bases allocation on productive capacity (km), not arbitrary time units.
- Explicitly models utilization via trip duration and uptime — making idle-time assumptions
  **visible and defensible**, not hidden in a divisor.
- Produces consistent ₹/km regardless of trip length, which is intuitive for freight buyers
  comparing per-km rates.
- Matches industry practice (logistics, asset-heavy industries typically depreciate by usage km).

**For simplicity:** Days-based is easier to teach ("divide monthly by 30, scale by trip days"). But
it conflates calendar time with productive usage and is opaque about utilization assumptions.

---

## Conflict 2: Vehicle Financing — Interest vs. Full EMI

### The Double-Counting Problem

A truck acquired on financed terms has three cost flows:

1. **Depreciation (asset wear):** The truck loses value over time, whether it runs or sits idle.
   ```
   depreciation_annual = (purchased_cost - salvage_value) / useful_life_years
   ```
   
2. **Loan payments (EMI):** Blended principal + interest.
   ```
   EMI_monthly = PMT(rate, terms, -principal)
   principal = 0.8 × purchased_cost  (e.g., 80% financed)
   interest_rate = 11% annually
   terms = 5 years = 60 months
   ```

3. **Carrying cost of money:** The interest portion of the EMI.

---

### Unnati's Approach (Interest Only + Depreciation)

**Principle:** Depreciation captures the asset's economic cost to the business. Interest captures
the cost of borrowing.

```
Vehicle_cost_annual = Depreciation + Interest_portion_of_EMI
```

**Why not both depreciation and full EMI?**

The loan principal is *not* a business expense — it's a redistribution of the business's own
cash. When you pay off the principal, you're buying back ownership from the lender. The
**economics** of owning the truck are:
- You buy it (cash out or borrow).
- It depreciates (economic loss, expense).
- If financed, you pay interest (actual cost, expense).

The principal repayment itself is **not an expense** — it's an exchange of cash for debt reduction
(an asset change, not a cost). Double-counting (depreciation *and* full EMI) overstates the true
cost by the principal amount.

**Implementation in Unnati:**

```
depreciation_annual = (landed_cost - salvage) / 5 / 2
interest_annual = SUM(interest_months_1_to_60) / 5
```

Unnati separately models each month of the loan to extract the true interest (principal balance
declines each month, so interest accrues on a declining balance). It then averages across the 5
years to get an annual interest figure.

---

### Draft PRD's Approach (EMI as a Fixed Cost)

The PRD listed **EMI** as a fixed component:
> "EMI | on | per-model; excludable"

This is **incorrect** if depreciation is also being charged. It double-counts the asset.

---

### Alternative: EMI Only, No Depreciation

It's *possible* to use full EMI and drop depreciation, but it breaks after the loan is paid off:
- Years 1–5 (financed): vehicle_cost = EMI (~₹48k/month including interest + principal).
- Year 6+ (fully owned): vehicle_cost = **0** (no EMI, no depreciation). But the truck is still
  wearing out!

So this method only works for the finite loan term and is financially misleading long-term.

---

### Which Is Correct?

**Unnati (interest + depreciation)** is the accounting-correct approach:
- Separates economic wear (depreciation) from financing carry cost (interest).
- Works correctly across the truck's entire life (financed + paid-off).
- Aligns with Generally Accepted Accounting Principles (GAAP) / IFRS standards.

**Full EMI + depreciation** is double-counting and will overstate freight cost by the principal
repayment amount.

**EMI only** is simpler but breaks post-loan-payoff and is not GAAP-compliant.

---

## Conflict 3: Overhead and Profit — Structure and Attribution

### Unnati's Approach (Two Markups on Cost Base)

**Principle:** Overhead and profit are distinct concepts and should be priced separately.

```
Overhead ₹/km = 7% × (Fixed/km + Fuel/km + Tyre/km + Maintenance/km)
Profit ₹/km   = 10% × (same base)

Total Freight = Cost_base + Overhead + Profit
```

**Rationale:**
- **Overhead (7%)** represents real costs not captured elsewhere: billing, dispatch, insurance
  administration, office rent, etc. It's proportional to the business's cost base (bigger trips,
  bigger overhead).
- **Profit (10%)** is the transporter's margin — the amount above cost at which to sell.

Both are percentages of the total **cost** (fixed + fuel + tyre + maintenance), not of each other.

---

### Draft PRD's Approach (Single Margin, Overhead Folded)

The PRD proposed:
> "Transporter margin" = `margin_pct × base cost`, where `base cost = fixed-per-trip + variable`.
> Margin source is configurable (fixed % now; region/customer variants are future-friendly but
> default to fixed 10%).

This **combines** overhead and profit into one markup:
```
Total Freight = Base Cost × (1 + 10%)
```

---

### Comparison: Numerical Impact

**Example:** A trip with €2,000 cost base.

#### **Unnati (two markups):**
```
overhead = ₹2,000 × 0.07 = ₹140
profit   = ₹2,000 × 0.10 = ₹200
total    = ₹2,000 + ₹140 + ₹200 = ₹2,340
markup % = (140+200)/2000 = 17%
```

#### **Single 10% margin:**
```
markup = ₹2,000 × 0.10 = ₹200
total   = ₹2,000 + ₹200 = ₹2,200
```

**Difference:** Unnati prices overhead explicitly; single-margin only captures profit, leaving
overhead implicit (or absent).

---

### Which Is Correct?

**Unnati's two-markup approach** is more transparent and realistic:
- Overhead is a **real cost**, not discretionary. It should be recovered separately.
- Profit is what's **left after all costs** (including overhead) are covered.
- This structure allows separate tuning per region, customer, or contract type.

**Single-margin approach** conflates the two and likely underestimates the true cost to the
transporter. It works only if the 10% is understood to include overhead — but that's implicit
and often missed in negotiations.

---

## Recommendation Summary

| Item | Unnati (Authoritative) | Draft PRD | Recommended Fix |
|---|---|---|---|
| **Fixed allocation** | Annual-km + uptime engine | Days-based ÷30×trip_days | Adopt Unnati; use uptime engine with transparent time/uptime inputs |
| **Financing** | Depreciation + interest | EMI (error) | Reject EMI; use depreciation + interest (or offer EMI-only as a fallback with warnings) |
| **Overhead/Profit** | Two markups (7%+10%) | Single margin (10%) | Adopt two markups; make both editable |

---

## Backward-Compatibility & Migration

Switching to Unnati's model will change per-trip ZBC output for existing calculations. **Reconciliation required:**
1. Run a sample of 20–50 trips from `data/fist200b4prob.xlsx` through both old and new models.
2. Document the delta (should be ~±15–20% depending on utilization assumptions).
3. Validate against real market freights to establish which model tracks closer to reality.
4. Provide a "model version" field in exports so historical calculations remain traceable.
