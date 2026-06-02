import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3001';
const SCREENSHOT_DIR = 'C:/Users/bhavika.garg/Desktop/zero-based-costing/verify-screenshots';

// Create screenshot directory
import { mkdirSync } from 'fs';
try { mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function shot(name) {
  const p = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`📸 ${name} → ${p}`);
}

try {
  // Step 1: Open the page
  console.log('\n--- Step 1: Open page ---');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await shot('01-page-load');

  const singleTab = await page.locator('button', { hasText: 'Single Trip' }).isVisible();
  const batchTab = await page.locator('button', { hasText: 'Batch Upload' }).isVisible();
  console.log(`Single Trip tab visible: ${singleTab}`);
  console.log(`Batch Upload tab visible: ${batchTab}`);

  // Step 2: Click Batch Upload tab
  console.log('\n--- Step 2: Click Batch Upload tab ---');
  await page.locator('button', { hasText: 'Batch Upload' }).click();
  await page.waitForTimeout(300);
  await shot('02-batch-tab');

  const uploadZone = await page.locator('text=Click or drag CSV here').isVisible();
  const templateLink = await page.locator('a', { hasText: 'Download template' }).isVisible();
  console.log(`Upload zone visible: ${uploadZone}`);
  console.log(`Template link visible: ${templateLink}`);

  // Step 3: Write the template CSV to a temp file and upload it
  console.log('\n--- Step 3: Upload template CSV ---');
  const csvContent = `body_type,capacity_tons,length_ft,axles,origin,destination,payload_tons,truck_model_id,mileage_kmpl,driver_per_day,bata_per_trip,night_halt_per_night,depreciation_per_km,vehicle_per_trip,state_permit,maintenance_per_km,loading_per_ton,idle_hours,idle_cost_per_hour,overhead_per_trip,risk_pct,empty_return_pct
open,16,20,2,Delhi,Mumbai,14,,,,,,,,,,,,,,,`;

  const csvPath = 'C:/Users/bhavika.garg/Desktop/zero-based-costing/test-batch.csv';
  writeFileSync(csvPath, csvContent);
  console.log(`Wrote test CSV to ${csvPath}`);

  // Use the hidden file input to upload
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(csvPath);
  await page.waitForTimeout(500);
  await shot('03-after-upload');

  // Step 4: Check for "1 trip ready to calculate"
  console.log('\n--- Step 4: Check validation result ---');
  const successMsg = await page.locator('text=1 trip').isVisible();
  const calcBtn = await page.locator('button', { hasText: /Calculate/ }).isVisible();
  console.log(`"1 trip ready" message visible: ${successMsg}`);
  console.log(`Calculate button visible: ${calcBtn}`);

  const pageText = await page.locator('.space-y-4').first().innerText();
  console.log('\nBatch upload section text:');
  console.log(pageText.substring(0, 300));

  // Step 5: Test invalid CSV (bad body_type)
  console.log('\n--- Step 5: Upload invalid CSV (bad body_type) ---');
  const badCsv = `body_type,capacity_tons,length_ft,axles,origin,destination,payload_tons,truck_model_id,mileage_kmpl,driver_per_day,bata_per_trip,night_halt_per_night,depreciation_per_km,vehicle_per_trip,state_permit,maintenance_per_km,loading_per_ton,idle_hours,idle_cost_per_hour,overhead_per_trip,risk_pct,empty_return_pct
sedan,16,20,2,Delhi,Mumbai,14,,,,,,,,,,,,,,,`;

  const badCsvPath = 'C:/Users/bhavika.garg/Desktop/zero-based-costing/test-bad.csv';
  writeFileSync(badCsvPath, badCsv);
  await fileInput.setInputFiles(badCsvPath);
  await page.waitForTimeout(500);
  await shot('04-invalid-csv');

  const errorVisible = await page.locator('text=body_type').isVisible();
  console.log(`body_type error visible: ${errorVisible}`);
  const errText = await page.locator('.space-y-4').first().innerText();
  console.log('\nError state text:');
  console.log(errText.substring(0, 400));

  console.log('\n✅ Verification complete');

} catch (e) {
  console.error('❌ Error:', e.message);
  await shot('error-state');
} finally {
  await browser.close();
}
