import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Algorithm,
  CompressionJob,
  CompressionOutcome,
  FolderAnalysis,
  GameEntry,
  JobDoneEvent,
  JobErrorEvent,
  LibraryEntry,
  LowGainEvent,
  ProgressEvent,
  QueueStatus,
  ScanPreset,
  ScanProgress,
  Settings,
  TelemetryEntry,
  WatchdogEvent,
} from "@/types/models";

// ---- Commands ----

export const isElevated = () => invoke<boolean>("is_elevated");
export const relaunchAsAdmin = () => invoke<void>("relaunch_as_admin");
export const openFolder = (path: string) => invoke<void>("open_folder", { path });
export const isContextMenuEnabled = () => invoke<boolean>("is_context_menu_enabled");
export const setContextMenu = (enabled: boolean) => invoke<void>("set_context_menu", { enabled });

export const analyzePath = (path: string) => invoke<FolderAnalysis>("analyze_path", { path });
export const queryCompression = (path: string) =>
  invoke<string | null>("query_compression", { path });
export const compressPath = (path: string, algorithm: Algorithm, skipLowGain: boolean) =>
  invoke<CompressionOutcome>("compress_path", { path, algorithm, skipLowGain });
export const decompressPath = (path: string) =>
  invoke<FolderAnalysis>("decompress_path", { path });

export const scanPresets = () => invoke<ScanPreset[]>("scan_presets");
export const scanPaths = (paths: string[]) => invoke<GameEntry[]>("scan_paths", { paths });

export const enqueueJobs = (jobs: CompressionJob[]) => invoke<void>("enqueue_jobs", { jobs });
export const startQueue = () => invoke<void>("start_queue");
export const cancelQueue = () => invoke<void>("cancel_queue");
export const skipCurrentJob = () => invoke<void>("skip_current_job");
export const queueStatus = () => invoke<QueueStatus>("queue_status");

// ---- Library (Home) ----

export const getLibrary = () => invoke<LibraryEntry[]>("get_library");
export const removeLibraryEntry = (path: string) =>
  invoke<void>("remove_library_entry", { path });
export const setWatchdog = (path: string, enabled: boolean) =>
  invoke<void>("set_watchdog", { path, enabled });
export const refreshLibraryEntry = (path: string) =>
  invoke<LibraryEntry>("refresh_library_entry", { path });

// ---- Telemetry database ----

export const fetchTelemetryDatabase = () =>
  invoke<TelemetryEntry[]>("fetch_telemetry_database");

// ---- Settings ----

export const getSettings = () => invoke<Settings>("get_settings");
export const setSettings = (settings: Settings) => invoke<void>("set_settings", { settings });

// ---- Events ----

export const onProgress = (cb: (e: ProgressEvent) => void): Promise<UnlistenFn> =>
  listen<ProgressEvent>("compress://progress", (ev) => cb(ev.payload));

export const onLowGain = (cb: (e: LowGainEvent) => void): Promise<UnlistenFn> =>
  listen<LowGainEvent>("compress://low-gain", (ev) => cb(ev.payload));

export const onJobDone = (cb: (e: JobDoneEvent) => void): Promise<UnlistenFn> =>
  listen<JobDoneEvent>("compress://job-done", (ev) => cb(ev.payload));

export const onJobError = (cb: (e: JobErrorEvent) => void): Promise<UnlistenFn> =>
  listen<JobErrorEvent>("compress://job-error", (ev) => cb(ev.payload));

export const onQueueDone = (cb: () => void): Promise<UnlistenFn> =>
  listen("compress://queue-done", () => cb());

export const onScanProgress = (cb: (e: ScanProgress) => void): Promise<UnlistenFn> =>
  listen<ScanProgress>("scan://progress", (ev) => cb(ev.payload));

export const onWatchdogDirty = (cb: (e: WatchdogEvent) => void): Promise<UnlistenFn> =>
  listen<WatchdogEvent>("watchdog://dirty", (ev) => cb(ev.payload));

export const onQueueExternal = (cb: () => void): Promise<UnlistenFn> =>
  listen("queue://external", () => cb());
