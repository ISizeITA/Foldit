/**
 * Signed Windows build for Foldit.
 *
 * Cleans the Tauri resource cache (so dist/ is always re-embedded), then runs
 * `pnpm tauri build` with the updater signing key. The private key lives
 * OUTSIDE the repo (default: ~/.tauri/foldit-updater.key, empty password) so
 * it is never committed.
 *
 * Usage:
 *   pnpm desktop:build              # clean + signed build
 *   pnpm desktop:build --no-clean   # incremental (skip cache cleanup)
 */
import { rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RELEASE_DIR = join(ROOT, "src-tauri", "target", "release");
const skipClean = process.argv.slice(2).includes("--no-clean");

function rm(path) {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
    console.log("  rm", path);
  } catch (e) {
    console.warn("  rm failed", path, e.message);
  }
}

function rmGlob(dir, prefix) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(prefix)) rm(join(dir, name));
  }
}

function cleanTauriCache() {
  console.log("clean: forcing tauri resource re-embed");
  rmGlob(join(RELEASE_DIR, "build"), "tauri-");
  rm(join(RELEASE_DIR, "foldit.exe"));
  rm(join(RELEASE_DIR, "foldit.pdb"));
  rmGlob(join(RELEASE_DIR, "deps"), "foldit-");
  rmGlob(join(RELEASE_DIR, ".fingerprint"), "foldit-");
}

if (!skipClean) cleanTauriCache();
else console.log("clean: skipped (--no-clean)");

const signingKey =
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  join(process.env.USERPROFILE || process.env.HOME || "", ".tauri", "foldit-updater.key");
if (!existsSync(signingKey) && !signingKey.startsWith("dW50")) {
  console.error(
    `Signing key not found: ${signingKey}\n` +
      "Set TAURI_SIGNING_PRIVATE_KEY to the key file path or its contents.",
  );
  process.exit(1);
}

console.log("\nbuild: vite + tauri (signed)");
const r = spawnSync("pnpm", ["tauri", "build"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: signingKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});
if (r.status !== 0) process.exit(r.status ?? 1);

const nsisDir = join(RELEASE_DIR, "bundle", "nsis");
const exes = existsSync(nsisDir)
  ? readdirSync(nsisDir)
      .filter((f) => f.endsWith("-setup.exe"))
      .map((f) => ({ f, mtime: statSync(join(nsisDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
  : [];
if (exes[0]) {
  console.log(`\nbuilt: ${exes[0].f}\nnext: pnpm desktop:publish`);
} else {
  console.error("no installer produced under", nsisDir);
  process.exit(1);
}
