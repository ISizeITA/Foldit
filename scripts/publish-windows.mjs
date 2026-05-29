/**
 * Publish a signed Windows release to ISizeITA/Foldit — the repo the in-app
 * auto-updater pulls from. Uploads the NSIS installer, its .sig, and a
 * latest.json updater manifest.
 *
 * Auth: GH_TOKEN env var, or the token stored by the git credential helper.
 * The token needs Contents:Write on ISizeITA/Foldit.
 *
 * Usage:
 *   pnpm desktop:publish                    # auto-discover the latest build
 *   pnpm desktop:publish --prerelease       # mark prerelease
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REPO = "ISizeITA/Foldit";

function tokenFromGitCredential() {
  try {
    const out = execSync("git credential fill", {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const m = out.match(/^password=(.*)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const TOKEN = process.env.GH_TOKEN || tokenFromGitCredential();
if (!TOKEN) {
  console.error("No GitHub token. Set GH_TOKEN, or `git push` once so the credential helper stores it.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const prerelease = process.argv.slice(2).includes("--prerelease");

const NSIS_DIR = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");

function newest(dir, suffix) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(suffix))
    .map((e) => join(dir, e.name));
  return files.length ? files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] : null;
}

const installer = newest(NSIS_DIR, "-setup.exe");
if (!installer) {
  console.error(`No NSIS installer under ${NSIS_DIR}. Run: pnpm desktop:build`);
  process.exit(1);
}
const sig = `${installer}.sig`;
try {
  statSync(sig);
} catch {
  console.error(`Signature missing: ${sig}\nTauri only emits .sig when the signing key is set at build time.`);
  process.exit(1);
}

const installerName = `Foldit_${VERSION}_x64-setup.exe`;
const sigName = `${installerName}.sig`;

const gh = (path, opts = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "foldit-windows-release",
      ...(opts.headers || {}),
    },
  });

let r = await gh(`/repos/${REPO}`);
if (!r.ok) {
  console.error("repo access failed", r.status, await r.text());
  process.exit(1);
}
console.log("repo OK:", (await r.json()).full_name);

r = await gh(`/repos/${REPO}/releases/tags/${TAG}`);
if (r.ok) {
  console.error(`release ${TAG} already exists — bump the version or delete it first`);
  process.exit(1);
}

r = await gh(`/repos/${REPO}/releases`, {
  method: "POST",
  body: JSON.stringify({
    tag_name: TAG,
    name: `Foldit ${TAG}`,
    body: "Installer below. The attached files also feed the in-app auto-updater.",
    draft: false,
    prerelease,
    make_latest: prerelease ? "false" : "true",
  }),
});
if (!r.ok) {
  console.error("create release failed", r.status, await r.text());
  process.exit(1);
}
const release = await r.json();
console.log("release created:", release.html_url);

async function uploadAsset(filePath, uploadName, contentType) {
  const buf = readFileSync(filePath);
  const up = await fetch(
    `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(uploadName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": contentType,
        "User-Agent": "foldit-windows-release",
      },
      body: buf,
    },
  );
  if (!up.ok) {
    console.error(`upload ${uploadName} failed`, up.status, await up.text());
    process.exit(1);
  }
  console.log(`uploaded ${uploadName} (${buf.length} bytes)`);
}

await uploadAsset(installer, installerName, "application/octet-stream");
await uploadAsset(sig, sigName, "text/plain");

const signature = readFileSync(sig, "utf8").replace(/[\r\n]+$/g, "");
const manifest = {
  version: VERSION,
  notes: "See the release page for changes.",
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${REPO}/releases/download/${TAG}/${installerName}`,
    },
  },
};
const upManifest = await fetch(
  `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=latest.json`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "foldit-windows-release",
    },
    body: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
  },
);
if (!upManifest.ok) {
  console.error("upload latest.json failed", upManifest.status, await upManifest.text());
  process.exit(1);
}
console.log("uploaded latest.json\nDONE:", release.html_url);
