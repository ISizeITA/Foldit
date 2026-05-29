import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Loader2,
  Search,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  cancelQueue,
  enqueueJobs,
  onJobDone,
  onJobError,
  onLowGain,
  onProgress,
  onQueueDone,
  fetchTelemetryDatabase,
  onScanProgress,
  relaunchAsAdmin,
  scanPaths,
  scanPresets,
  skipCurrentJob,
  startQueue,
} from "@/lib/ipc";
import { cn, formatBytes, formatPercent } from "@/lib/utils";
import { useSettings } from "@/store/settingsStore";
import type {
  Algorithm,
  GameEntry,
  ScanPreset,
  ScanProgress,
  TelemetryEntry,
} from "@/types/models";

const ALGORITHMS: Algorithm[] = ["XPRESS4K", "XPRESS8K", "XPRESS16K", "LZX"];

type SortKey = "name" | "status" | "estimate" | "size" | "savings";
type StatusFilter = "all" | "uncompressed" | "compressed";
// Logical order so ascending groups the not-yet-compressed folders first.
const statusRank = (s: string) =>
  s === "uncompressed" ? 0 : s === "ntfs" ? 1 : s === "partial" ? 2 : 3;
// "uncompressed" group = anything not yet compressed with Foldit's WOF.
const statusGroup = (s: string) =>
  s === "uncompressed" || s === "partial" || s === "ntfs" ? "uncompressed" : "compressed";

const formatEta = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};
// Critical Windows locations we warn about before scanning/compressing.
const isSystemPath = (p: string) => /^[a-z]:\\$/i.test(p) || /^[a-z]:\\windows(\\|$)/i.test(p);

interface ActiveJob {
  jobId: string;
  processed: number;
  total: number;
  compressed: number;
  speed: number;
  etaSec: number | null;
}

interface RunIssues {
  accessDenied: number;
  locked: number;
  failed: number;
}

export function ScannerPage() {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const settingsLoaded = useSettings((s) => s.loaded);
  const updateSettings = useSettings((s) => s.update);

  const [presets, setPresets] = useState<ScanPreset[]>([]);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const customPaths = settings.customPaths ?? [];

  const [entries, setEntries] = useState<GameEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  const [algorithm, setAlgorithm] = useState<Algorithm>(settings.defaultAlgorithm);
  const syncedRef = useRef(false);

  const [queueRunning, setQueueRunning] = useState(false);
  const [totalJobs, setTotalJobs] = useState(0);
  const [doneJobs, setDoneJobs] = useState(0);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [lowGainJob, setLowGainJob] = useState<string | null>(null);
  const [runIssues, setRunIssues] = useState<RunIssues | null>(null);
  const jobStartRef = useRef<{ id: string; t: number } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "size",
    dir: "desc",
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [telemetryDb, setTelemetryDb] = useState<Map<string, TelemetryEntry>>(new Map());

  // Pull the crowdsourced DB once so we can show an estimated savings per game.
  useEffect(() => {
    fetchTelemetryDatabase()
      .then((list) => setTelemetryDb(new Map(list.map((e) => [e.name.toLowerCase(), e]))))
      .catch(() => {});
  }, []);

  const estimateFor = (name: string): number | null => {
    const stat = telemetryDb.get(name.toLowerCase())?.algorithms[algorithm];
    return stat ? 1 - stat.avgRatio : null;
  };

  // Load presets and preselect the ones that exist on this machine.
  useEffect(() => {
    scanPresets()
      .then((p) => {
        setPresets(p);
        setSelectedPresets(new Set(p.filter((x) => x.available).map((x) => x.id)));
      })
      .catch(() => {});
  }, []);

  // Seed the algorithm + skip toggle from the saved defaults, once loaded.
  useEffect(() => {
    if (settingsLoaded && !syncedRef.current) {
      syncedRef.current = true;
      setAlgorithm(settings.defaultAlgorithm);
    }
  }, [settingsLoaded, settings.defaultAlgorithm]);

  const notifyDone = async () => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title: "Foldit", body: t("scanner.notifyDone") });
    } catch {
      /* notifications unavailable — ignore */
    }
  };

  // Subscribe to all backend events once.
  useEffect(() => {
    let active = true;
    const unsubs: UnlistenFn[] = [];
    const register = (u: UnlistenFn) => (active ? unsubs.push(u) : u());

    void onScanProgress((p) => setScanProgress(p)).then(register);
    void onProgress((e) => {
      setQueueRunning(true); // also reveals the panel for externally-started jobs
      const now = Date.now();
      if (jobStartRef.current?.id !== e.jobId) jobStartRef.current = { id: e.jobId, t: now };
      const elapsed = (now - jobStartRef.current.t) / 1000;
      const speed = elapsed > 0 ? e.processed / elapsed : 0;
      const etaSec = speed > 0 ? (e.total - e.processed) / speed : null;
      setActiveJob({
        jobId: e.jobId,
        processed: e.processed,
        total: e.total,
        compressed: e.compressed,
        speed,
        etaSec,
      });
    }).then(register);
    void onLowGain((e) => setLowGainJob(e.jobId)).then(register);
    void onJobDone((e) => {
      setDoneJobs((c) => c + 1);
      setLowGainJob(null);
      setRunIssues((prev) => ({
        accessDenied: (prev?.accessDenied ?? 0) + e.outcome.accessDenied,
        locked: (prev?.locked ?? 0) + e.outcome.filesLocked,
        failed: (prev?.failed ?? 0) + e.outcome.filesFailed,
      }));
      setEntries((prev) =>
        prev.map((en) =>
          en.path === e.outcome.path
            ? {
                ...en,
                status: e.outcome.algorithm,
                physicalSize: e.outcome.compressedSize,
                compressedFiles: e.outcome.filesProcessed,
                savingsRatio:
                  e.outcome.originalSize > 0
                    ? 1 - e.outcome.compressedSize / e.outcome.originalSize
                    : 0,
              }
            : en,
        ),
      );
    }).then(register);
    void onJobError((e) => console.error("compression job failed", e.jobId, e.message)).then(register);
    void onQueueDone(() => {
      setQueueRunning(false);
      setActiveJob(null);
      setLowGainJob(null);
      setDoneJobs(0);
      setTotalJobs(0);
      void notifyDone();
    }).then(register);

    return () => {
      active = false;
      unsubs.forEach((u) => u());
    };
  }, []);

  const togglePreset = (id: string) =>
    setSelectedPresets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleEntry = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const addCustomFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string" || customPaths.includes(picked)) return;
    if (isSystemPath(picked)) {
      const ok = await confirm(t("scanner.systemWarn"), { title: "Foldit", kind: "warning" });
      if (!ok) return;
    }
    void updateSettings({ customPaths: [...customPaths, picked] });
  };

  const runScan = async () => {
    const paths = [
      ...presets.filter((p) => selectedPresets.has(p.id)).flatMap((p) => p.paths),
      ...customPaths,
    ];
    if (paths.length === 0) return;
    setScanning(true);
    setScanProgress({ done: 0, total: 0, current: "" });
    setEntries([]);
    setSelected(new Set());
    try {
      const result = await scanPaths(paths);
      setEntries(result);
      setSelected(new Set(result.filter((e) => e.status === "uncompressed").map((e) => e.path)));
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  };

  const compressSelected = async () => {
    const jobs = entries
      .filter((e) => selected.has(e.path))
      .map((e) => ({ id: e.path, path: e.path, algorithm, skipLowGain: settings.skipLowGain }));
    if (jobs.length === 0) return;
    setTotalJobs(jobs.length);
    setDoneJobs(0);
    setRunIssues(null);
    jobStartRef.current = null;
    setQueueRunning(true);
    await enqueueJobs(jobs);
    await startQueue();
  };

  const selectedSize = useMemo(
    () =>
      entries.filter((e) => selected.has(e.path)).reduce((sum, e) => sum + e.logicalSize, 0),
    [entries, selected],
  );

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );

  const sortedEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = entries;
    if (statusFilter !== "all") list = list.filter((e) => statusGroup(e.status) === statusFilter);
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sort.key === "name") cmp = a.name.localeCompare(b.name);
      else if (sort.key === "status")
        cmp = statusRank(a.status) - statusRank(b.status) || a.status.localeCompare(b.status);
      else if (sort.key === "estimate")
        cmp = (estimateFor(a.name) ?? -1) - (estimateFor(b.name) ?? -1);
      else if (sort.key === "size") cmp = a.logicalSize - b.logicalSize;
      else cmp = a.savingsRatio - b.savingsRatio;
      return cmp * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sort, search, statusFilter, telemetryDb, algorithm]);

  const totals = useMemo(() => {
    const size = sortedEntries.reduce((s, e) => s + e.logicalSize, 0);
    const saved = sortedEntries.reduce((s, e) => s + Math.max(0, e.logicalSize - e.physicalSize), 0);
    return { count: sortedEntries.length, size, saved };
  }, [sortedEntries]);

  const selectedEstimate = useMemo(() => {
    let bytes = 0;
    let hasData = false;
    for (const e of entries) {
      if (!selected.has(e.path)) continue;
      const est = estimateFor(e.name);
      if (est !== null) {
        bytes += est * e.logicalSize;
        hasData = true;
      }
    }
    return hasData ? bytes : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, selected, telemetryDb, algorithm]);

  const allSelected = sortedEntries.length > 0 && sortedEntries.every((e) => selected.has(e.path));
  const toggleSelectAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) sortedEntries.forEach((e) => next.delete(e.path));
      else sortedEntries.forEach((e) => next.add(e.path));
      return next;
    });

  const sortArrow = (k: SortKey) =>
    sort.key === k ? (
      sort.dir === "asc" ? (
        <ChevronUp size={12} />
      ) : (
        <ChevronDown size={12} />
      )
    ) : null;

  const activeName = activeJob
    ? (entries.find((e) => e.path === activeJob.jobId)?.name ?? activeJob.jobId)
    : "";
  const activePct = activeJob && activeJob.total > 0 ? (activeJob.processed / activeJob.total) * 100 : 0;
  const activeSavings =
    activeJob && activeJob.processed > 0 ? 1 - activeJob.compressed / activeJob.processed : 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("scanner.title")} subtitle={t("scanner.subtitle")} />

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-6">
        {/* Sources */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("scanner.presets")}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 rounded-md border border-border bg-bg-panel px-3 py-2 text-sm ${
                    p.available ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-accent"
                    disabled={!p.available}
                    checked={selectedPresets.has(p.id)}
                    onChange={() => togglePreset(p.id)}
                  />
                  <span className="text-ink-base">
                    {p.id === "programs" || p.id === "userPrograms"
                      ? t(`scanner.preset.${p.id}`)
                      : p.label}
                  </span>
                  {!p.available && (
                    <span className="ml-auto text-xs text-ink-faint">{t("scanner.notAvailable")}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("scanner.custom")}
            </h3>
            <div className="flex flex-col gap-2">
              {customPaths.map((path) => (
                <div
                  key={path}
                  className="flex items-center gap-2 rounded-md border border-border bg-bg-panel px-3 py-2 text-sm"
                >
                  <span className="truncate text-ink-muted" title={path}>
                    {path}
                  </span>
                  <button
                    onClick={() =>
                      void updateSettings({ customPaths: customPaths.filter((p) => p !== path) })
                    }
                    className="ml-auto text-ink-faint hover:text-ink-base"
                    title={t("scanner.remove")}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="self-start" onClick={addCustomFolder}>
                <FolderPlus size={16} />
                {t("scanner.addFolder")}
              </Button>
            </div>
          </div>
        </section>

        {/* Compression options */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("scanner.options")}
          </h3>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-bg-panel px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="accent-accent"
              checked={settings.skipLowGain}
              onChange={(e) => void updateSettings({ skipLowGain: e.target.checked })}
            />
            <span className="text-ink-base">{t("scanner.skipLowGain")}</span>
          </label>
          <p className="mt-1 text-xs text-ink-faint">{t("scanner.skipLowGainHint")}</p>
        </section>

        <div className="flex items-center gap-3">
          <Button onClick={runScan} disabled={scanning}>
            {scanning && <Loader2 size={16} className="animate-spin" />}
            {scanning ? t("scanner.scanning") : t("scanner.scan")}
          </Button>
          {scanning && scanProgress && (
            <span className="text-xs text-ink-muted">
              {scanProgress.done}/{scanProgress.total} · {scanProgress.current}
            </span>
          )}
        </div>

        {/* Results */}
        <section className="flex min-h-0 flex-1 flex-col rounded-panel border border-border bg-bg-surface">
          {entries.length === 0 ? (
            <div className="p-8 text-sm text-ink-faint">{t("scanner.empty")}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("scanner.search")}
                    className="w-48 rounded-md border border-border bg-bg-panel py-1.5 pl-8 pr-2 text-sm text-ink-base outline-none placeholder:text-ink-faint"
                  />
                </div>
                <div className="flex items-center overflow-hidden rounded-md border border-border text-sm">
                  {(["all", "uncompressed", "compressed"] as StatusFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setStatusFilter(f)}
                      className={cn(
                        "px-2.5 py-1 transition-colors",
                        statusFilter === f
                          ? "bg-bg-elevated text-ink-base"
                          : "text-ink-muted hover:text-ink-base",
                      )}
                    >
                      {t(`scanner.filter.${f}`)}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                  {t("scanner.selectAll")}
                </label>
                <div className="ml-auto flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    {t("scanner.algorithm")}
                    <select
                      value={algorithm}
                      onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
                      className="rounded-md border border-border bg-bg-panel px-2 py-1 text-sm text-ink-base outline-none"
                    >
                      {ALGORITHMS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button onClick={compressSelected} disabled={selected.size === 0 || queueRunning}>
                    {t("scanner.compressSelected", { count: selected.size })}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {sortedEntries.length === 0 ? (
                  <div className="p-8 text-sm text-ink-faint">{t("scanner.noResults")}</div>
                ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-surface text-left text-xs uppercase tracking-wide text-ink-faint">
                    <tr className="border-b border-border">
                      <th className="w-10 px-4 py-2" />
                      <th className="px-4 py-2">
                        <button
                          onClick={() => toggleSort("name")}
                          className="inline-flex items-center gap-1 uppercase transition-colors hover:text-ink-base"
                        >
                          {t("scanner.col.name")}
                          {sortArrow("name")}
                        </button>
                      </th>
                      <th className="px-4 py-2">
                        <button
                          onClick={() => toggleSort("status")}
                          className="inline-flex items-center gap-1 uppercase transition-colors hover:text-ink-base"
                        >
                          {t("scanner.col.status")}
                          {sortArrow("status")}
                        </button>
                      </th>
                      <th className="px-4 py-2 text-right">
                        <button
                          onClick={() => toggleSort("estimate")}
                          className="inline-flex items-center gap-1 uppercase transition-colors hover:text-ink-base"
                        >
                          {t("scanner.col.estimate")}
                          {sortArrow("estimate")}
                        </button>
                      </th>
                      <th className="px-4 py-2 text-right">
                        <button
                          onClick={() => toggleSort("size")}
                          className="inline-flex items-center gap-1 uppercase transition-colors hover:text-ink-base"
                        >
                          {t("scanner.col.size")}
                          {sortArrow("size")}
                        </button>
                      </th>
                      <th className="px-4 py-2 text-right">
                        <button
                          onClick={() => toggleSort("savings")}
                          className="inline-flex items-center gap-1 uppercase transition-colors hover:text-ink-base"
                        >
                          {t("scanner.col.savings")}
                          {sortArrow("savings")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((e) => (
                      <tr key={e.path} className="border-b border-border-subtle hover:bg-bg-panel/50">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            className="accent-accent"
                            checked={selected.has(e.path)}
                            onChange={() => toggleEntry(e.path)}
                          />
                        </td>
                        <td className="px-4 py-2 text-ink-base" title={e.path}>
                          {e.name}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {estimateFor(e.name) === null ? (
                            <span className="text-ink-faint">—</span>
                          ) : (
                            <span className="text-accent">{formatPercent(estimateFor(e.name)!)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                          {formatBytes(e.logicalSize)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-accent-save">
                          {e.savingsRatio > 0.001 ? formatPercent(e.savingsRatio) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-ink-faint">
                <span>
                  {t("scanner.selectedSummary", {
                    count: selected.size,
                    size: formatBytes(selectedSize),
                  })}
                  {selectedEstimate !== null && (
                    <span className="text-accent">
                      {" · "}
                      {t("scanner.estSavings", { size: formatBytes(selectedEstimate) })}
                    </span>
                  )}
                </span>
                <span>
                  {t("scanner.total", {
                    count: totals.count,
                    size: formatBytes(totals.size),
                    saved: formatBytes(totals.saved),
                  })}
                </span>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Compression queue progress */}
      {queueRunning && (
        <div className="border-t border-border bg-bg-surface px-8 py-4">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-medium text-ink-base">{t("scanner.queue.title")}</span>
            <span className="text-xs text-ink-muted">
              {t("scanner.queue.folder", { n: doneJobs + 1, total: Math.max(totalJobs, doneJobs + 1) })}
            </span>
            <span className="truncate text-xs text-ink-faint">{activeName}</span>
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              onClick={() => void cancelQueue()}
            >
              {t("scanner.queue.cancel")}
            </Button>
          </div>
          <Progress value={activePct} />
          <div className="mt-1 flex items-center justify-between text-xs text-ink-faint">
            <span className="tabular-nums">
              {formatBytes(activeJob?.processed ?? 0)} / {formatBytes(activeJob?.total ?? 0)}
              {activeJob && activeJob.speed > 0 && (
                <>
                  {" · "}
                  {formatBytes(activeJob.speed)}/s
                  {activeJob.etaSec !== null && <> · ~{formatEta(activeJob.etaSec)}</>}
                </>
              )}
            </span>
            <span className="tabular-nums text-accent-save">
              {t("scanner.queue.savings")}: {formatPercent(activeSavings)}
            </span>
          </div>

          {lowGainJob && (
            <div className="mt-3 flex items-center gap-3 rounded-md border border-accent-warn/40 bg-accent-warn/10 px-3 py-2 text-sm text-accent-warn">
              <span>{t("scanner.lowGain.message")}</span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => void skipCurrentJob()}
              >
                {t("scanner.lowGain.skip")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Post-run issues (failed / locked / permission) */}
      {!queueRunning &&
        runIssues &&
        runIssues.accessDenied + runIssues.locked + runIssues.failed > 0 && (
          <div className="flex items-center gap-3 border-t border-border bg-accent-warn/10 px-8 py-3 text-sm text-accent-warn">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              {t("scanner.issues", {
                admin: runIssues.accessDenied,
                locked: runIssues.locked,
                failed: runIssues.failed,
              })}
            </span>
            {runIssues.accessDenied > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void relaunchAsAdmin().catch(() => {})}
              >
                {t("admin.relaunch")}
              </Button>
            )}
            <button
              onClick={() => setRunIssues(null)}
              className="ml-auto text-ink-faint hover:text-ink-base"
            >
              <X size={14} />
            </button>
          </div>
        )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === "uncompressed") return <Badge tone="neutral">{t("scanner.status.uncompressed")}</Badge>;
  if (status === "partial") return <Badge tone="warn">{t("scanner.status.partial")}</Badge>;
  if (status === "ntfs") return <Badge tone="warn">{t("scanner.status.ntfs")}</Badge>;
  return <Badge tone="accent">{status}</Badge>;
}
