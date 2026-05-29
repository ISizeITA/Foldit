use tauri::{AppHandle, State};

use crate::error::{FolditError, Result};
use crate::models::Settings;
use crate::persist;
use crate::state::AppState;

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<()> {
    persist::save_settings(&app, &settings)?;
    let mut current = state
        .settings
        .lock()
        .map_err(|_| FolditError::Task("settings lock poisoned".into()))?;
    *current = settings;
    Ok(())
}
