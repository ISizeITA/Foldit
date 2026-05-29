//! "Update monitoring": watches the user's compressed folders and, when a
//! launcher drops NEW files in (a game update), emits `watchdog://dirty` so
//! the UI can offer a quick re-compression.
//!
//! We react only to file *creation* events: our own WOF (de)compression
//! rewrites files in place (Modify events), so it never self-triggers.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::models::WatchdogEvent;
use crate::state::AppState;

/// Minimum gap between two `dirty` events for the same folder.
const DEBOUNCE: Duration = Duration::from_secs(15);

fn build_watcher(
    app: AppHandle,
    watched: Arc<Mutex<Vec<String>>>,
) -> notify::Result<RecommendedWatcher> {
    let debounce: Arc<Mutex<HashMap<String, Instant>>> = Arc::new(Mutex::new(HashMap::new()));

    notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else {
            return;
        };
        if !matches!(event.kind, EventKind::Create(_)) {
            return;
        }
        let roots = watched.lock().map(|g| g.clone()).unwrap_or_default();
        for changed in &event.paths {
            let changed_str = changed.to_string_lossy();
            let Some(root) = roots.iter().find(|r| changed_str.starts_with(r.as_str())) else {
                continue;
            };
            let mut deb = match debounce.lock() {
                Ok(d) => d,
                Err(_) => return,
            };
            let now = Instant::now();
            let fire = deb.get(root).map_or(true, |last| now.duration_since(*last) > DEBOUNCE);
            if fire {
                deb.insert(root.clone(), now);
                let _ = app.emit(
                    "watchdog://dirty",
                    WatchdogEvent {
                        path: root.clone(),
                        file: changed.display().to_string(),
                    },
                );
            }
            break; // one event per change is enough
        }
    })
}

/// Create the watcher (stored in state) and start watching the enabled folders.
pub fn init(app: AppHandle, state: &AppState, enabled: &[String]) {
    match build_watcher(app, state.watched.clone()) {
        Ok(watcher) => {
            if let Ok(mut slot) = state.watcher.lock() {
                *slot = Some(watcher);
            }
            for path in enabled {
                watch_path(state, path);
            }
        }
        Err(e) => eprintln!("watchdog init failed: {e}"),
    }
}

pub fn watch_path(state: &AppState, path: &str) {
    let Ok(mut slot) = state.watcher.lock() else {
        return;
    };
    let Some(watcher) = slot.as_mut() else {
        return;
    };
    if watcher
        .watch(Path::new(path), RecursiveMode::Recursive)
        .is_ok()
    {
        if let Ok(mut watched) = state.watched.lock() {
            if !watched.iter().any(|p| p == path) {
                watched.push(path.to_string());
            }
        }
    }
}

pub fn unwatch_path(state: &AppState, path: &str) {
    if let Ok(mut slot) = state.watcher.lock() {
        if let Some(watcher) = slot.as_mut() {
            let _ = watcher.unwatch(Path::new(path));
        }
    }
    if let Ok(mut watched) = state.watched.lock() {
        watched.retain(|p| p != path);
    }
}
