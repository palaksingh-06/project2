# Configuration files

## truck-rates.json

Per-truck operational rates. Replace benchmark values with your fleet actuals:

- Driver/day, bata, night halt — payroll / transporter contracts
- Vehicle ₹/km — asset register or hire charge ÷ km
- Maintenance ₹/km — workshop annual spend ÷ km
- Loading — plant labour rates
- Idle — detention SLA
- Risk %, empty-return % — management policy / TMS

## fallback-rates.json

Used when live APIs fail. Tune `toll_per_km` quarterly.

`diesel_by_state` is only used if [The Core fuel API](https://energy.thecore.in/api/india-state-prices) is unreachable.

## cities-cache.json

Geocode fallback and spelling suggestions for origin/destination fields.
