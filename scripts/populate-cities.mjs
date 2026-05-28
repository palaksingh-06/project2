/**
 * Populates config/cities-cache.json with coordinates from Nominatim.
 * Respects OSM's 1 req/sec rate limit. Safe to re-run — merges with existing entries.
 *
 * Usage: node scripts/populate-cities.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, "../config/cities-cache.json");

const CITIES_TO_FETCH = [
  // Tier 1
  "Delhi", "Mumbai", "Bangalore", "Chennai", "Kolkata", "Hyderabad", "Pune",
  "Ahmedabad", "Jaipur", "Lucknow",
  // Tier 2 — UP / Uttarakhand
  "Kanpur", "Varanasi", "Prayagraj", "Agra", "Meerut", "Ghaziabad", "Noida",
  "Bareilly", "Aligarh", "Moradabad", "Gorakhpur", "Saharanpur", "Muzaffarnagar",
  "Mathura", "Dehradun", "Haridwar", "Haldwani",
  // Tier 2 — Punjab / Haryana / HP / J&K
  "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Chandigarh",
  "Ambala", "Panipat", "Rohtak", "Hisar", "Karnal", "Gurgaon", "Faridabad",
  "Jammu", "Srinagar", "Shimla", "Mandi",
  // Tier 2 — Rajasthan
  "Jodhpur", "Bikaner", "Kota", "Ajmer", "Udaipur", "Alwar", "Bharatpur",
  // Tier 2 — MP / Chhattisgarh
  "Indore", "Bhopal", "Jabalpur", "Gwalior", "Ratlam", "Ujjain", "Raipur",
  "Bhilai", "Bilaspur",
  // Tier 2 — Maharashtra
  "Nagpur", "Navi Mumbai", "Nashik", "Aurangabad", "Solapur", "Kolhapur",
  "Amravati", "Akola", "Latur", "Nanded", "Dhule", "Jalgaon", "Sangli",
  "Satara", "Ratnagiri", "Kalyan", "Thane",
  // Tier 2 — Gujarat
  "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Junagadh", "Anand",
  "Gandhinagar", "Mehsana", "Bharuch", "Vapi", "Valsad", "Navsari",
  // Tier 2 — Karnataka
  "Mysore", "Hubli", "Belgaum", "Mangalore", "Davangere", "Tumkur", "Gulbarga",
  "Bellary", "Bidar", "Raichur", "Hospet", "Udupi",
  // Tier 2 — Tamil Nadu
  "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Erode",
  "Vellore", "Thanjavur", "Dindigul", "Tuticorin", "Pondicherry",
  // Tier 2 — Kerala
  "Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Kannur", "Kollam",
  "Palakkad",
  // Tier 2 — Andhra Pradesh / Telangana
  "Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore", "Kurnool",
  "Kakinada", "Rajahmundry", "Eluru", "Ongole", "Anantapur",
  // Tier 2 — Odisha / West Bengal / Jharkhand
  "Bhubaneswar", "Cuttack", "Siliguri", "Durgapur", "Asansol", "Jamshedpur",
  "Dhanbad", "Bokaro", "Ranchi",
  // Tier 2 — North East
  "Guwahati", "Silchar", "Dibrugarh", "Imphal", "Agartala", "Shillong",
  "Aizawl", "Kohima", "Itanagar", "Gangtok",
  // Tier 2 — Bihar
  "Patna",
];

const DELAY_MS = 1100; // Nominatim policy: max 1 req/sec

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchNominatim(city) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ", India")}&format=json&limit=1&countrycodes=in&addressdetails=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "zero-based-costing/populate-cities (bhaviskwel@gmail.com)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const hits = await res.json();
  if (!hits.length) return null;
  const hit = hits[0];
  const state =
    hit.address?.state ||
    hit.display_name.split(",").slice(-2, -1)[0]?.trim() ||
    "India";
  return {
    name: city,
    state,
    lat: parseFloat(hit.lat),
    lng: parseFloat(hit.lon),
  };
}

async function main() {
  // Load existing cache
  let existing = { cities: [] };
  try {
    existing = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    console.log("No existing cache found — starting fresh.");
  }

  // Index existing by normalised name so we don't re-fetch
  const byName = new Map(
    existing.cities.map((c) => [c.name.trim().toLowerCase(), c])
  );

  const results = [...existing.cities]; // start with what we have

  for (const city of CITIES_TO_FETCH) {
    const key = city.trim().toLowerCase();
    if (byName.has(key)) {
      console.log(`  [skip] ${city} (already cached)`);
      continue;
    }

    process.stdout.write(`  [fetch] ${city} ... `);
    try {
      await sleep(DELAY_MS);
      const entry = await fetchNominatim(city);
      if (entry) {
        results.push(entry);
        byName.set(key, entry);
        console.log(`${entry.lat.toFixed(4)}, ${entry.lng.toFixed(4)} (${entry.state})`);
      } else {
        console.log("NOT FOUND — skipped");
      }
    } catch (err) {
      console.log(`ERROR: ${err.message} — skipped`);
    }
  }

  // Sort alphabetically and write
  results.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(CACHE_PATH, JSON.stringify({ cities: results }, null, 2), "utf8");
  console.log(`\nDone. ${results.length} cities written to config/cities-cache.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
