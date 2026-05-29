use tauri::{AppHandle, Emitter};

use crate::error::{FolditError, Result};
use crate::models::{GameEntry, ScanPreset, ScanProgress};
use crate::scanner;

#[tauri::command]
pub fn scan_presets() -> Vec<ScanPreset> {
    scanner::presets::presets()
}

#[tauri::command]
pub async fn scan_paths(app: AppHandle, paths: Vec<String>) -> Result<Vec<GameEntry>> {
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan(&paths, |done, total, name| {
            let _ = app.emit(
                "scan://progress",
                ScanProgress {
                    done: done as u64,
                    total: total as u64,
                    current: name.to_string(),
                },
            );
        })
    })
    .await
    .map_err(|e| FolditError::Task(e.to_string()))
}
