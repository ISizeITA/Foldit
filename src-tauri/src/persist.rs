//! Tiny JSON-file persistence for the user's compressed-folder library.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::{FolditError, Result};
use crate::models::{CompressionOutcome, LibraryEntry, Settings, TelemetryEntry};
use crate::state::AppState;

fn config_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| FolditError::WinApi(format!("config dir: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn library_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(config_dir(app)?.join("library.json"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(config_dir(app)?.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<()> {
    std::fs::write(settings_path(app)?, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

// Local cache of the telemetry database, so the estimates keep working when the
// Worker is unreachable (offline, cold start, token expired, ...).
pub fn save_telemetry_cache(app: &AppHandle, entries: &[TelemetryEntry]) {
    if let Ok(dir) = config_dir(app) {
        if let Ok(data) = serde_json::to_string(entries) {
            let _ = std::fs::write(dir.join("telemetry_cache.json"), data);
        }
    }
}

pub fn load_telemetry_cache(app: &AppHandle) -> Option<Vec<TelemetryEntry>> {
    let dir = config_dir(app).ok()?;
    let data = std::fs::read_to_string(dir.join("telemetry_cache.json")).ok()?;
    serde_json::from_str(&data).ok()
}

/// A stable, random, anonymous client id (created once, reused thereafter).
pub fn client_id(app: &AppHandle) -> String {
    let Ok(dir) = config_dir(app) else {
        return uuid::Uuid::new_v4().to_string();
    };
    let path = dir.join("client_id");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::write(&path, &id);
    id
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn load(app: &AppHandle) -> Vec<LibraryEntry> {
    let Ok(path) = library_path(app) else {
        return Vec::new();
    };
    let Ok(data) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save(app: &AppHandle, entries: &[LibraryEntry]) -> Result<()> {
    let path = library_path(app)?;
    std::fs::write(path, serde_json::to_string_pretty(entries)?)?;
    Ok(())
}

pub fn upsert(lib: &mut Vec<LibraryEntry>, entry: LibraryEntry) {
    if let Some(existing) = lib.iter_mut().find(|e| e.path == entry.path) {
        // Preserve the user's watchdog preference across re-compressions.
        let watchdog = existing.watchdog;
        *existing = LibraryEntry { watchdog, ..entry };
    } else {
        lib.push(entry);
    }
}

pub fn entry_from_outcome(o: &CompressionOutcome) -> LibraryEntry {
    LibraryEntry {
        path: o.path.clone(),
        name: Path::new(&o.path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
        algorithm: o.algorithm.clone(),
        original_size: o.original_size,
        compressed_size: o.compressed_size,
        saved_bytes: o.saved_bytes,
        file_count: o.files_processed,
        watchdog: false,
        updated_at: now_secs(),
    }
}

/// Upsert a finished job into the persisted library (best-effort).
pub fn record_outcome(app: &AppHandle, outcome: &CompressionOutcome) {
    let library = app.state::<AppState>().library.clone();
    let Ok(mut lib) = library.lock() else {
        return;
    };
    upsert(&mut lib, entry_from_outcome(outcome));
    let _ = save(app, &lib);
}
