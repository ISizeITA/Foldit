/**
 * One-off seed for Foldit's telemetry database.
 *
 * Fetches the public, community-measured compression ratios from CompactGUI's
 * data branch and converts the raw *facts* (game folder name + before/after
 * byte counts per algorithm) into Foldit's own database.json schema. We do not
 * copy CompactGUI's file or its structure — only the underlying numeric facts,
 * re-derived into our own format — so the result seeds our DB without carrying
 * over their project's code/format.
 *
 * Output: cloudflare-worker/database.seed.json
 * Then upload that file's content as `database.json` on the ISizeITA/Foldit repo
 * (replacing the initial `[]`). The Worker keeps updating it from there.
 *
 * Usage:  node scripts/seed-database.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://raw.githubusercontent.com/IridiumIO/CompactGUI/database/database.json";
const ALGO = { 0: "XPRESS4K", 1: "XPRESS8K", 2: "XPRESS16K", 3: "LZX" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "cloudflare-worker", "database.seed.json");

const now = Math.floor(Date.now() / 1000);

console.log("Fetching source database…");
const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`Fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const raw = await res.json();
console.log(`Source games: ${raw.length}`);

/** key (lowercased name) -> our TelemetryEntry */
const map = new Map();

for (const game of raw) {
  const name = (game.FolderName || "").trim() || (game.GameName || "").trim();
  if (!name) continue;
  const key = name.toLowerCase();
  let entry = map.get(key);
  if (!entry) {
    entry = { name, samples: 0, algorithms: {}, updatedAt: now };
    map.set(key, entry);
  }
  for (const r of game.CompressionResults || []) {
    const algo = ALGO[r.CompType];
    if (!algo || !r.BeforeBytes || r.BeforeBytes <= 0) continue;
    const ratio = Math.min(1, Math.max(0, r.AfterBytes / r.BeforeBytes));
    const samples = r.TotalResults > 0 ? r.TotalResults : 1;
    const prev = entry.algorithms[algo];
    if (prev) {
      // Merge duplicate folder names with a sample-weighted average.
      const total = prev.samples + samples;
      entry.algorithms[algo] = {
        avgRatio: (prev.avgRatio * prev.samples + ratio * samples) / total,
        samples: total,
      };
    } else {
      entry.algorithms[algo] = { avgRatio: ratio, samples };
    }
  }
}

const out = [...map.values()]
  .map((e) => {
    e.samples = Object.values(e.algorithms).reduce((a, x) => a + x.samples, 0);
    for (const k of Object.keys(e.algorithms)) {
      e.algorithms[k].avgRatio = Math.round(e.algorithms[k].avgRatio * 1e5) / 1e5;
    }
    return e;
  })
  .filter((e) => Object.keys(e.algorithms).length > 0)
  .sort((a, b) => a.name.localeCompare(b.name));

// Minified to keep the file small (the Worker stores it minified too).
writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`Wrote ${out.length} entries → ${OUT}`);
