mod commands;
mod compression;
mod context_menu;
mod error;
mod models;
mod persist;
mod scanner;
mod state;
mod system;
mod telemetry;
mod watchdog;

use tauri::Manager;

use state::AppState;

/// Extract the folder from a `--compress <path>` (or `--compress=<path>`) argv.
fn compress_arg(argv: &[String]) -> Option<String> {
    let mut it = argv.iter();
    while let Some(a) = it.next() {
        if a == "--compress" {
            return it.next().cloned();
        }
        if let Some(rest) = a.strip_prefix("--compress=") {
            return Some(rest.to_string());
        }
    }
    None
}

pub fn run() {
    tauri::Builder::default()
        // Single-instance must be registered first: a second launch (e.g. from
        // the Explorer menu) forwards its argv here instead of opening a window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = compress_arg(&argv) {
                commands::compression::enqueue_and_start_path(app, path);
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .setup(|app| {
            let loaded = persist::load(app.handle());
            let enabled: Vec<String> = loaded
                .iter()
                .filter(|e| e.watchdog)
                .map(|e| e.path.clone())
                .collect();
            let settings = persist::load_settings(app.handle());
            let state = app.state::<AppState>();
            if let Ok(mut lib) = state.library.lock() {
                *lib = loaded;
            }
            if let Ok(mut s) = state.settings.lock() {
                *s = settings;
            }
            let state = state.inner();
            watchdog::init(app.handle().clone(), state, &enabled);

            // Handle `--compress <path>` passed to this (first) instance.
            if let Some(path) = compress_arg(&std::env::args().collect::<Vec<_>>()) {
                commands::compression::enqueue_and_start_path(app.handle(), path);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::is_elevated,
            commands::system::relaunch_as_admin,
            commands::system::open_folder,
            commands::system::is_context_menu_enabled,
            commands::system::set_context_menu,
            commands::compression::analyze_path,
            commands::compression::query_compression,
            commands::compression::compress_path,
            commands::compression::decompress_path,
            commands::compression::enqueue_jobs,
            commands::compression::start_queue,
            commands::compression::cancel_queue,
            commands::compression::skip_current_job,
            commands::compression::queue_status,
            commands::scanner::scan_presets,
            commands::scanner::scan_paths,
            commands::library::get_library,
            commands::library::remove_library_entry,
            commands::library::set_watchdog,
            commands::library::refresh_library_entry,
            commands::telemetry::fetch_telemetry_database,
            commands::settings::get_settings,
            commands::settings::set_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Foldit");
}
