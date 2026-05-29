// Foldit telemetry Worker — PLAIN JS for the Cloudflare dashboard editor.
// (The dashboard does not compile TypeScript; use this file there. The .ts
//  version under src/ is for the wrangler CLI flow.)
//
// Configure in the dashboard → Settings → Variables and Secrets:
//   GH_OWNER     (var)    e.g. ISizeITA
//   GH_REPO      (var)    e.g. Foldit
//   GH_BRANCH    (var)    e.g. main
//   DB_PATH      (var)    e.g. database.json
//   GITHUB_TOKEN (secret) the fine-grained PAT (Contents: Read and write)

const ALGORITHMS = new Set(["XPRESS4K", "XPRESS8K", "XPRESS16K", "LZX"]);
const MAX_CONFLICT_RETRIES = 4;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method === "GET") {
      const { entries } = await readDatabase(env);
      return json(entries);
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    let report;
    try {
      report = await request.json();
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }

    const error = validate(report);
    if (error) return json({ error }, 400);

    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
      const { entries, sha } = await readDatabase(env);
      applyReport(entries, report);
      const ok = await writeDatabase(env, entries, sha);
      if (ok) return json({ ok: true });
    }
    return json({ error: "write conflict, please retry" }, 503);
  },
};

function validate(r) {
  if (typeof r?.gameName !== "string" || r.gameName.trim().length === 0) return "missing gameName";
  if (r.gameName.length > 200) return "gameName too long";
  if (!ALGORITHMS.has(r.algorithm)) return "unknown algorithm";
  if (!Number.isFinite(r.ratio)) return "invalid ratio";
  return null;
}

function applyReport(entries, r) {
  const name = r.gameName.trim();
  const ratio = Math.min(1, Math.max(0, r.ratio));
  let entry = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!entry) {
    entry = { name, samples: 0, algorithms: {}, updatedAt: 0 };
    entries.push(entry);
  }
  const prev = entry.algorithms[r.algorithm] ?? { avgRatio: 0, samples: 0 };
  const samples = prev.samples + 1;
  const avgRatio = (prev.avgRatio * prev.samples + ratio) / samples;
  entry.algorithms[r.algorithm] = { avgRatio, samples };
  entry.samples += 1;
  entry.updatedAt = Math.floor(Date.now() / 1000);
}

// Read via the Git Data API (branch -> commit -> tree -> blob). This resolves
// the branch name reliably and has no 1 MB size limit (Blobs go up to 100 MB).
async function readDatabase(env) {
  const base = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}`;
  // branch -> latest commit -> root tree sha (a real SHA the tree API accepts).
  const commitRes = await fetch(`${base}/commits/${env.GH_BRANCH}`, { headers: ghHeaders(env) });
  if (commitRes.status === 404) return { entries: [], sha: null };
  if (!commitRes.ok) throw new Error(`commit read failed: ${commitRes.status}`);
  const treeSha = (await commitRes.json()).commit?.tree?.sha;
  if (!treeSha) return { entries: [], sha: null };

  const treeRes = await fetch(`${base}/git/trees/${treeSha}?recursive=1`, { headers: ghHeaders(env) });
  if (!treeRes.ok) throw new Error(`tree read failed: ${treeRes.status}`);
  const node = ((await treeRes.json()).tree || []).find((n) => n.path === env.DB_PATH);
  if (!node) return { entries: [], sha: null };

  const blobRes = await fetch(`${base}/git/blobs/${node.sha}`, { headers: ghHeaders(env) });
  if (!blobRes.ok) throw new Error(`blob read failed: ${blobRes.status}`);
  const text = fromBase64((await blobRes.json()).content);
  const entries = text.trim() ? JSON.parse(text) : [];
  return { entries, sha: node.sha };
}

async function writeDatabase(env, entries, sha) {
  const body = {
    message: "chore(telemetry): update database.json",
    content: toBase64(JSON.stringify(entries)), // minified to keep the file small
    branch: env.GH_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(contentsUrl(env), {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) return false; // stale sha → retry
  if (!res.ok) throw new Error(`GitHub write failed: ${res.status}`);
  return true;
}

function contentsUrl(env) {
  return `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${env.DB_PATH}`;
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "foldit-telemetry-worker",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
