import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { FolderOpen, RefreshCw, Trash2, Undo2 } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  decompressPath,
  enqueueJobs,
  getLibrary,
  onJobDone,
  onProgress,
  onWatchdogDirty,
  openFolder,
  refreshLibraryEntry,
  removeLibraryEntry,
  setWatchdog,
  startQueue,
} from "@/lib/ipc";
import { cn, formatBytes, formatPercent } from "@/lib/utils";
import { useSettings } from "@/store/settingsStore";
import type { Algorithm, LibraryEntry } from "@/types/models";

const ALGORITHMS = ["XPRESS4K", "XPRESS8K", "XPRESS16K", "LZX"];

export function HomePage() {
  const { t, i18n } = useTranslation();
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  const [activeJob, setActiveJob] = useState<{ jobId: string; processed: number; total: number } | null>(
    null,
  );

  const settings = useSettings((s) => s.settings);

  const reload = useCallback(async () => {
    const entries = await getLibrary().catch(() => [] as LibraryEntry[]);
    setLibrary(entries);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Keep the list fresh on job completion, and flag folders the watchdog
  // reports as having new uncompressed files.
  useEffect(() => {
    let active = true;
    const unsubs: UnlistenFn[] = [];
    const reg = (u: UnlistenFn) => (active ? unsubs.push(u) : u());
    void onJobDone((e) => {
      void reload();
      setActiveJob(null);
      setDirtyPaths((prev) => {
        const next = new Set(prev);
        next.delete(e.outcome.path);
        return next;
      });
    }).then(reg);
    void onProgress((e) => {
      setActiveJob({ jobId: e.jobId, processed: e.processed, total: e.total });
    }).then(reg);
    void onWatchdogDirty((e) => {
      setDirtyPaths((prev) => new Set(prev).add(e.path));
    }).then(reg);
    return () => {
      active = false;
      unsubs.forEach((u) => u());
    };
  }, [reload]);

  const selected = library.find((e) => e.path === selectedPath) ?? null;
  const totalSaved = library.reduce((sum, e) => sum + e.savedBytes, 0);

  const upsertLocal = (entry: LibraryEntry) =>
    setLibrary((prev) => prev.map((e) => (e.path === entry.path ? entry : e)));

  const toggleWatchdog = async (entry: LibraryEntry) => {
    const next = !entry.watchdog;
    upsertLocal({ ...entry, watchdog: next });
    await setWatchdog(entry.path, next).catch(() => upsertLocal(entry));
  };

  const refresh = async (path: string) => {
    setBusy(true);
    try {
      const updated = await refreshLibraryEntry(path);
      upsertLocal(updated);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (path: string) => {
    setBusy(true);
    try {
      await decompressPath(path);
      const updated = await refreshLibraryEntry(path);
      upsertLocal(updated);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    await removeLibraryEntry(path);
    if (selectedPath === path) setSelectedPath(null);
    await reload();
  };

  const recompress = async (entry: LibraryEntry) => {
    const algorithm = (
      ALGORITHMS.includes(entry.algorithm) ? entry.algorithm : "XPRESS8K"
    ) as Algorithm;
    await enqueueJobs([
      { id: entry.path, path: entry.path, algorithm, skipLowGain: settings.skipLowGain },
    ]);
    await startQueue();
    setDirtyPaths((prev) => {
      const next = new Set(prev);
      next.delete(entry.path);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("home.title")}
        subtitle={t("home.subtitle")}
        actions={
          library.length > 0 ? (
            <div className="text-right">
              <div className="text-base font-semibold text-accent-save">
                {formatBytes(totalSaved)}
              </div>
              <div className="text-xs text-ink-faint">
                {t("home.acrossFolders", { count: library.length })}
              </div>
            </div>
          ) : undefined
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] overflow-hidden">
        {/* Left: library list */}
        <div className="min-h-0 overflow-y-auto border-r border-border">
          {library.length === 0 ? (
            <div className="p-6 text-sm text-ink-faint">{t("home.empty")}</div>
          ) : (
            <ul className="p-2">
              {library.map((entry) => (
                <li key={entry.path}>
                  <button
                    onClick={() => setSelectedPath(entry.path)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors",
                      selectedPath === entry.path ? "bg-bg-elevated" : "hover:bg-bg-panel",
                    )}
                  >
                    <span className="truncate text-sm text-ink-base" title={entry.path}>
                      {entry.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone="accent">{entry.algorithm}</Badge>
                      <span className="text-xs tabular-nums text-accent-save">
                        {formatBytes(entry.savedBytes)} {t("home.saved")}
                      </span>
                      {dirtyPaths.has(entry.path) && (
                        <span
                          className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent-warn"
                          title={t("home.newFiles")}
                        />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: control panel */}
        <div className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="p-8 text-sm text-ink-faint">{t("home.selectPrompt")}</div>
          ) : (
            <div className="flex flex-col gap-6 p-8">
              <div>
                <h3 className="text-lg font-semibold text-ink-base">{selected.name}</h3>
                <p className="truncate text-xs text-ink-faint" title={selected.path}>
                  {selected.path}
                </p>
              </div>

              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold text-accent-save">
                  {formatBytes(selected.savedBytes)}
                </span>
                <span className="text-sm text-ink-muted">
                  {t("home.saved")} ·{" "}
                  {formatPercent(
                    selected.originalSize > 0 ? selected.savedBytes / selected.originalSize : 0,
                  )}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <Stat label={t("home.method")}>
                  <Badge tone="accent">{selected.algorithm}</Badge>
                </Stat>
                <Stat label={t("home.files")}>
                  <span className="tabular-nums text-ink-base">{selected.fileCount}</span>
                </Stat>
                <Stat label={t("home.original")}>
                  <span className="tabular-nums text-ink-base">
                    {formatBytes(selected.originalSize)}
                  </span>
                </Stat>
                <Stat label={t("home.compressed")}>
                  <span className="tabular-nums text-ink-base">
                    {formatBytes(selected.compressedSize)}
                  </span>
                </Stat>
              </dl>

              <div className="flex items-start gap-3 rounded-panel border border-border bg-bg-panel p-4">
                <Switch checked={selected.watchdog} onChange={() => void toggleWatchdog(selected)} />
                <div>
                  <div className="text-sm text-ink-base">{t("home.watchdog")}</div>
                  <div className="text-xs text-ink-faint">{t("home.watchdogHint")}</div>
                </div>
              </div>

              {activeJob && activeJob.jobId === selected.path && (
                <div>
                  <Progress
                    value={activeJob.total > 0 ? (activeJob.processed / activeJob.total) * 100 : 0}
                  />
                  <div className="mt-1 text-xs tabular-nums text-ink-faint">
                    {formatBytes(activeJob.processed)} / {formatBytes(activeJob.total)}
                  </div>
                </div>
              )}

              {dirtyPaths.has(selected.path) && (
                <div className="flex items-center gap-3 rounded-md border border-accent-warn/40 bg-accent-warn/10 px-3 py-2 text-sm text-accent-warn">
                  <span>{t("home.watchdogAlert")}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => void recompress(selected)}
                  >
                    {t("home.recompress")}
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void refresh(selected.path)}>
                  <RefreshCw size={16} className={busy ? "animate-spin" : undefined} />
                  {t("home.actions.refresh")}
                </Button>
                <Button variant="outline" onClick={() => void openFolder(selected.path).catch(() => {})}>
                  <FolderOpen size={16} />
                  {t("home.actions.open")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void rollback(selected.path)}>
                  <Undo2 size={16} />
                  {t("home.actions.rollback")}
                </Button>
                <Button variant="danger" className="ml-auto" onClick={() => void remove(selected.path)}>
                  <Trash2 size={16} />
                  {t("home.actions.remove")}
                </Button>
              </div>

              {selected.updatedAt > 0 && (
                <p className="text-xs text-ink-faint">
                  {t("home.updated")}:{" "}
                  {new Date(selected.updatedAt * 1000).toLocaleString(i18n.language)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
