use std::collections::VecDeque;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use notify::RecommendedWatcher;

use crate::models::{CompressionJob, LibraryEntry, Settings};

/// Shared, Tauri-managed application state.
///
/// All fields are `Arc`-wrapped so the single queue worker (a spawned task)
/// and the synchronous command handlers can share them safely.
pub struct AppState {
    /// Jobs waiting to be processed, oldest first.
    pub queue: Arc<Mutex<VecDeque<CompressionJob>>>,
    /// True while the worker task is draining the queue.
    pub running: Arc<AtomicBool>,
    /// Aborts the whole queue and the in-flight job.
    pub cancel: Arc<AtomicBool>,
    /// Stops only the current folder early (used by the low-gain "skip" offer).
    pub skip: Arc<AtomicBool>,
    /// In-memory cache of the persisted library, loaded at startup.
    pub library: Arc<Mutex<Vec<LibraryEntry>>>,
    /// Filesystem watcher for the "update monitoring" feature (set in setup).
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    /// Folders currently watched (so the watcher callback can map events back).
    pub watched: Arc<Mutex<Vec<String>>>,
    /// Persisted user preferences, loaded at startup.
    pub settings: Arc<Mutex<Settings>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            running: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
            skip: Arc::new(AtomicBool::new(false)),
            library: Arc::new(Mutex::new(Vec::new())),
            watcher: Arc::new(Mutex::new(None)),
            watched: Arc::new(Mutex::new(Vec::new())),
            settings: Arc::new(Mutex::new(Settings::default())),
        }
    }
}
