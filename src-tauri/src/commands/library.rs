use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use crate::compression;
use crate::error::{FolditError, Result};
use crate::models::LibraryEntry;
use crate::persist;
use crate::state::AppState;
use crate::watchdog;

#[tauri::command]
pub fn get_library(state: State<AppState>) -> Vec<LibraryEntry> {
    state.library.lock().map(|l| l.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn remove_library_entry(app: AppHandle, state: State<AppState>, path: String) -> Result<()> {
    let mut lib = state
        .library
        .lock()
        .map_err(|_| FolditError::Task("library lock poisoned".into()))?;
    lib.retain(|e| e.path != path);
    persist::save(&app, &lib)?;
    drop(lib);
    watchdog::unwatch_path(state.inner(), &path);
    Ok(())
}

#[tauri::command]
pub fn set_watchdog(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    enabled: bool,
) -> Result<()> {
    let mut lib = state
        .library
        .lock()
        .map_err(|_| FolditError::Task("library lock poisoned".into()))?;
    if let Some(entry) = lib.iter_mut().find(|e| e.path == path) {
        entry.watchdog = enabled;
    }
    persist::save(&app, &lib)?;
    drop(lib);
    if enabled {
        watchdog::watch_path(state.inner(), &path);
    } else {
        watchdog::unwatch_path(state.inner(), &path);
    }
    Ok(())
}

/// Re-analyze a folder on disk and refresh its library entry (e.g. after a
/// game update added uncompressed files).
#[tauri::command]
pub async fn refresh_library_entry(app: AppHandle, path: String) -> Result<LibraryEntry> {
    // Clone the Arc and drop the State guard before awaiting (keeps the future Send).
    let library = {
        let state = app.state::<AppState>();
        state.library.clone()
    };

    let scan_path = PathBuf::from(&path);
    let analysis = tauri::async_runtime::spawn_blocking(move || compression::analyze(&scan_path))
        .await
        .map_err(|e| FolditError::Task(e.to_string()))??;

    let mut lib = library
        .lock()
        .map_err(|_| FolditError::Task("library lock poisoned".into()))?;
    let prev = lib.iter().find(|e| e.path == path);
    let entry = LibraryEntry {
        path: path.clone(),
        name: Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
        algorithm: analysis
            .dominant_algorithm
            .clone()
            .or_else(|| prev.map(|e| e.algorithm.clone()))
            .unwrap_or_default(),
        original_size: analysis.logical_size,
        compressed_size: analysis.physical_size,
        saved_bytes: analysis.logical_size.saturating_sub(analysis.physical_size),
        file_count: analysis.file_count,
        watchdog: prev.map(|e| e.watchdog).unwrap_or(false),
        updated_at: persist::now_secs(),
    };
    persist::upsert(&mut lib, entry.clone());
    persist::save(&app, &lib)?;
    Ok(entry)
}
