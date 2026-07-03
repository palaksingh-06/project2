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
