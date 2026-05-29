use crate::error::FolditError;

#[tauri::command]
pub fn is_elevated() -> bool {
    crate::system::is_elevated()
}

#[tauri::command]
pub fn relaunch_as_admin() -> Result<(), FolditError> {
    crate::system::relaunch_as_admin()
}

/// Open a folder in Windows Explorer. `path` always comes from the library
/// (never raw web input), and is passed as a single argument (no shell).
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), FolditError> {
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| FolditError::WinApi(format!("explorer failed: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn is_context_menu_enabled() -> bool {
    crate::context_menu::is_registered()
}

#[tauri::command]
pub fn set_context_menu(enabled: bool) -> Result<(), FolditError> {
    if enabled {
        let exe = std::env::current_exe()?.to_string_lossy().to_string();
        crate::context_menu::register(&exe).map_err(|e| FolditError::WinApi(e.to_string()))?;
    } else {
        crate::context_menu::unregister().map_err(|e| FolditError::WinApi(e.to_string()))?;
    }
    Ok(())
}
