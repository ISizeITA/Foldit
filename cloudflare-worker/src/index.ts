/**
 * Foldit telemetry Worker.
 *
 * POST /  → accepts an anonymous TelemetryReport, folds it into a running
 *            per-algorithm average inside database.json on GitHub.
 * GET  /  → returns the current database.json (live, no CDN cache).
 *
 * The GitHub token lives ONLY here, as a Worker secret — it is never shipped
 * inside the Foldit app.
 */

interface Env {
  GITHUB_TOKEN: string;
  GH_OWNER: string;
  GH_REPO: string;
  GH_BRANCH: string;
  DB_PATH: string;
}

interface TelemetryReport {
  appVersion: string;
  gameName: string;
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  fileCount: number;
  clientHash: string;
}

interface AlgoStat {
  avgRatio: number;
  samples: number;
}

interface TelemetryEntry {
  name: string;
  samples: number;
  algorithms: Record<string, AlgoStat>;
  updatedAt: number;
}

const ALGORITHMS = new Set(["XPRESS4K", "XPRESS8K", "XPRESS16K", "LZX"]);
const MAX_CONFLICT_RETRIES = 4;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method === "GET") {
      const { entries } = await readDatabase(env);
      return json(entries);
    }
    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    let report: TelemetryReport;
    try {
      report = (await request.json()) as TelemetryReport;
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
      // 409 conflict (someone else wrote first) → re-read and retry.
    }
    return json({ error: "write conflict, please retry" }, 503);
  },
};

function validate(r: TelemetryReport): string | null {
  if (typeof r?.gameName !== "string" || r.gameName.trim().length === 0) return "missing gameName";
  if (r.gameName.length > 200) return "gameName too long";
  if (!ALGORITHMS.has(r.algorithm)) return "unknown algorithm";
  if (!Number.isFinite(r.ratio)) return "invalid ratio";
  return null;
}

function applyReport(entries: TelemetryEntry[], r: TelemetryReport): void {
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

// Resolve the file (and its blob sha) via the Contents API with ?ref (handles
// branch names); for files >1 MB the content comes back empty, so we then read
// the blob by sha (Blobs API supports up to 100 MB).
async function readDatabase(env: Env): Promise<{ entries: TelemetryEntry[]; sha: string | null }> {
  const base = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}`;
  const commitRes = await fetch(`${base}/commits/${env.GH_BRANCH}`, { headers: ghHeaders(env) });
  if (commitRes.status === 404) return { entries: [], sha: null };
  if (!commitRes.ok) throw new Error(`commit read failed: ${commitRes.status}`);
  const treeSha = ((await commitRes.json()) as { commit?: { tree?: { sha?: string } } }).commit?.tree
    ?.sha;
  if (!treeSha) return { entries: [], sha: null };

  const treeRes = await fetch(`${base}/git/trees/${treeSha}?recursive=1`, { headers: ghHeaders(env) });
  if (!treeRes.ok) throw new Error(`tree read failed: ${treeRes.status}`);
  const tree = (await treeRes.json()) as { tree: { path: string; sha: string }[] };
  const node = (tree.tree || []).find((n) => n.path === env.DB_PATH);
  if (!node) return { entries: [], sha: null };

  const blobRes = await fetch(`${base}/git/blobs/${node.sha}`, { headers: ghHeaders(env) });
  if (!blobRes.ok) throw new Error(`blob read failed: ${blobRes.status}`);
  const blob = (await blobRes.json()) as { content: string };
  const text = fromBase64(blob.content);
  const entries = text.trim() ? (JSON.parse(text) as TelemetryEntry[]) : [];
  return { entries, sha: node.sha };
}

async function writeDatabase(
  env: Env,
  entries: TelemetryEntry[],
  sha: string | null,
): Promise<boolean> {
  const body: Record<string, unknown> = {
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
  if (res.status === 409 || res.status === 422) return false; // stale sha → caller retries
  if (!res.ok) throw new Error(`GitHub write failed: ${res.status}`);
  return true;
}

function contentsUrl(env: Env): string {
  return `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${env.DB_PATH}`;
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "foldit-telemetry-worker",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
