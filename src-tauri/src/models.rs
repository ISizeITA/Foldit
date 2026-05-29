use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::compression::algorithm::Algorithm;

/// Snapshot of a folder's current compression state, sent to the UI.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderAnalysis {
    pub path: String,
    pub logical_size: u64,
    pub physical_size: u64,
    pub file_count: u64,
    pub compressed_files: u64,
    /// Files using the legacy NTFS compression (LZNT1), not WOF.
    pub ntfs_compressed_files: u64,
    pub dominant_algorithm: Option<String>,
    pub savings_ratio: f32,
}

/// Result of a completed compression pass over a folder.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompressionOutcome {
    pub path: String,
    pub algorithm: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub saved_bytes: u64,
    pub ratio: f32,
    pub files_processed: u64,
    pub files_skipped: u64,
    /// Files that couldn't be opened due to missing permissions.
    pub access_denied: u64,
    /// Files locked by another process (e.g. the game is running).
    pub files_locked: u64,
    /// Any other per-file failure.
    pub files_failed: u64,
}

/// `watchdog://dirty` — a watched folder received a new (uncompressed) file.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogEvent {
    pub path: String,
    pub file: String,
}

/// Anonymous report POSTed to the Cloudflare Worker after a successful job.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryReport {
    pub app_version: String,
    pub game_name: String,
    pub algorithm: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub ratio: f32,
    pub file_count: u64,
    pub client_hash: String,
}

/// Per-algorithm aggregate stored in the crowdsourced database.json.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlgoStat {
    pub avg_ratio: f32,
    pub samples: u64,
}

/// One game/program row of the crowdsourced compression database.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEntry {
    pub name: String,
    pub samples: u64,
    pub algorithms: HashMap<String, AlgoStat>,
    pub updated_at: u64,
}

/// A folder the user has compressed, persisted across restarts (library.json).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub path: String,
    pub name: String,
    pub algorithm: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub saved_bytes: u64,
    pub file_count: u64,
    pub watchdog: bool,
    pub updated_at: u64,
}

/// A preset install location for a game launcher (Steam, Epic, ...).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanPreset {
    pub id: String,
    pub label: String,
    /// Only the candidate paths that actually exist on this machine.
    pub paths: Vec<String>,
    pub available: bool,
}

/// One game/program folder found by the scanner.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameEntry {
    pub name: String,
    pub path: String,
    pub logical_size: u64,
    pub physical_size: u64,
    pub savings_ratio: f32,
    pub file_count: u64,
    pub compressed_files: u64,
    /// "uncompressed" | "partial" | algorithm name (e.g. "XPRESS8K").
    pub status: String,
}

/// `scan://progress` — fired as each candidate folder is analyzed.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: u64,
    pub total: u64,
    pub current: String,
}

/// A single unit of work in the sequential compression queue.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompressionJob {
    pub id: String,
    pub path: String,
    pub algorithm: Algorithm,
    /// Revert files whose per-file compression gain is below the threshold.
    pub skip_low_gain: bool,
}

/// Persisted user preferences (settings.json).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub default_algorithm: Algorithm,
    pub skip_low_gain: bool,
    pub telemetry_enabled: bool,
    pub language: String,
    /// User-added scan folders, persisted across restarts.
    #[serde(default)]
    pub custom_paths: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_algorithm: Algorithm::Xpress8k,
            skip_low_gain: true,
            telemetry_enabled: true,
            language: "it".to_string(),
            custom_paths: Vec::new(),
        }
    }
}

/// Reported by `queue_status` so the UI can render the global queue state.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub running: bool,
    pub pending: u64,
}

// ---- Event payloads (emitted by the worker, consumed via `listen`) ----

/// `compress://progress` — fired after each file of the current job.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub job_id: String,
    pub processed: u64,
    pub total: u64,
    pub compressed: u64,
    pub files_processed: u64,
}

/// `compress://low-gain` — fired once when early savings stay under the
/// threshold, so the UI can offer to skip the folder.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LowGainEvent {
    pub job_id: String,
    pub savings_ratio: f32,
}

/// `compress://job-done` — fired when a job finishes (or is skipped).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobDoneEvent {
    pub job_id: String,
    pub outcome: CompressionOutcome,
}

/// `compress://job-error` — fired when a job fails outright.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobErrorEvent {
    pub job_id: String,
    pub message: String,
}
