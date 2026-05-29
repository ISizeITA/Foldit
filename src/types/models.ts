// TypeScript mirrors of the Rust serde structs. Keep field names in sync with
// the `#[serde(rename_all = "camelCase")]` structs in src-tauri/src/models.rs.

export type Algorithm = "XPRESS4K" | "XPRESS8K" | "XPRESS16K" | "LZX";

export interface FolderAnalysis {
  path: string;
  logicalSize: number;
  physicalSize: number;
  fileCount: number;
  compressedFiles: number;
  ntfsCompressedFiles: number;
  dominantAlgorithm: string | null;
  savingsRatio: number;
}

export interface CompressionOutcome {
  path: string;
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  savedBytes: number;
  ratio: number;
  filesProcessed: number;
  filesSkipped: number;
  accessDenied: number;
  filesLocked: number;
  filesFailed: number;
}

export interface CompressionJob {
  id: string;
  path: string;
  algorithm: Algorithm;
  skipLowGain: boolean;
}

export interface Settings {
  defaultAlgorithm: Algorithm;
  skipLowGain: boolean;
  telemetryEnabled: boolean;
  language: string;
  customPaths: string[];
}

export interface ScanPreset {
  id: string;
  label: string;
  paths: string[];
  available: boolean;
}

export interface GameEntry {
  name: string;
  path: string;
  logicalSize: number;
  physicalSize: number;
  savingsRatio: number;
  fileCount: number;
  compressedFiles: number;
  status: string;
}

export interface ScanProgress {
  done: number;
  total: number;
  current: string;
}

export interface LibraryEntry {
  path: string;
  name: string;
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  savedBytes: number;
  fileCount: number;
  watchdog: boolean;
  updatedAt: number;
}

export interface WatchdogEvent {
  path: string;
  file: string;
}

export interface AlgoStat {
  avgRatio: number;
  samples: number;
}

export interface TelemetryEntry {
  name: string;
  samples: number;
  algorithms: Record<string, AlgoStat>;
  updatedAt: number;
}

export interface QueueStatus {
  running: boolean;
  pending: number;
}

export interface ProgressEvent {
  jobId: string;
  processed: number;
  total: number;
  compressed: number;
  filesProcessed: number;
}

export interface LowGainEvent {
  jobId: string;
  savingsRatio: number;
}

export interface JobDoneEvent {
  jobId: string;
  outcome: CompressionOutcome;
}

export interface JobErrorEvent {
  jobId: string;
  message: string;
}
