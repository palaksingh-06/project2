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
