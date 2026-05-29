use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::compression::{self, algorithm::Algorithm};
use crate::error::{FolditError, Result};
use crate::models::{
    CompressionJob, CompressionOutcome, FolderAnalysis, JobDoneEvent, JobErrorEvent, LowGainEvent,
    ProgressEvent, QueueStatus,
};
use crate::state::AppState;

/// After this many processed bytes, if savings are still under the threshold,
/// the folder's files are almost certainly already compressed at the source.
const LOW_GAIN_PROBE_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB
const LOW_GAIN_THRESHOLD: f32 = 0.01; // 1%

// ---- One-shot folder commands (used by Home page single actions) ----

#[tauri::command]
pub async fn analyze_path(path: String) -> Result<FolderAnalysis> {
    run_blocking(move || compression::analyze(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn query_compression(path: String) -> Result<Option<String>> {
    run_blocking(move || {
        Ok(compression::wof::query_file(&PathBuf::from(path))?.map(|a| a.name().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn compress_path(
    path: String,
    algorithm: Algorithm,
    skip_low_gain: bool,
) -> Result<CompressionOutcome> {
    run_blocking(move || {
        let cancel = Arc::new(AtomicBool::new(false));
        let skip = Arc::new(AtomicBool::new(false));
        compression::compress(
            &PathBuf::from(path),
            algorithm,
            skip_low_gain,
            cancel,
            skip,
            |_progress| {},
        )
    })
    .await
}

#[tauri::command]
pub async fn decompress_path(path: String) -> Result<FolderAnalysis> {
    run_blocking(move || compression::decompress(&PathBuf::from(path))).await
}

// ---- Sequential queue (used by the bulk "Compress selected" flow) ----

#[tauri::command]
pub fn enqueue_jobs(state: State<AppState>, jobs: Vec<CompressionJob>) -> Result<()> {
    let mut queue = state
        .queue
        .lock()
        .map_err(|_| FolditError::Task("queue lock poisoned".into()))?;
    for job in jobs {
        queue.push_back(job);
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_queue(state: State<AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
    if let Ok(mut queue) = state.queue.lock() {
        queue.clear();
    }
}

#[tauri::command]
pub fn skip_current_job(state: State<AppState>) {
    state.skip.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn queue_status(state: State<AppState>) -> QueueStatus {
    let pending = state.queue.lock().map(|q| q.len() as u64).unwrap_or(0);
    QueueStatus {
        running: state.running.load(Ordering::SeqCst),
        pending,
    }
}

/// Start draining the queue. No-op if a worker is already running, so it is
/// safe to call after every `enqueue_jobs`.
#[tauri::command]
pub fn start_queue(app: AppHandle, state: State<AppState>) {
    start_worker(app, state.inner());
}

/// Enqueue one folder (using the saved settings) and start the worker. Used by
/// the Explorer context-menu integration (`foldit.exe --compress <path>`).
pub fn enqueue_and_start_path(app: &AppHandle, path: String) {
    let state = app.state::<AppState>();
    let (algorithm, skip_low_gain) = state
        .settings
        .lock()
        .map(|s| (s.default_algorithm, s.skip_low_gain))
        .unwrap_or((Algorithm::default(), true));
    if let Ok(mut queue) = state.queue.lock() {
        if !queue.iter().any(|j| j.path == path) {
            queue.push_back(CompressionJob {
                id: path.clone(),
                path,
                algorithm,
                skip_low_gain,
            });
        }
    }
    start_worker(app.clone(), state.inner());
    // Let the UI jump to the Scanner so the progress is visible.
    let _ = app.emit("queue://external", ());
}

/// Spawn the single sequential worker (no-op if one is already running).
pub fn start_worker(app: AppHandle, state: &AppState) {
    // Atomic swap guarantees a single worker even under concurrent calls.
    if state.running.swap(true, Ordering::SeqCst) {
        return;
    }
    state.cancel.store(false, Ordering::SeqCst);

    let queue = state.queue.clone();
    let running = state.running.clone();
    let cancel = state.cancel.clone();
    let skip = state.skip.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let Some(job) = queue.lock().ok().and_then(|mut q| q.pop_front()) else {
                break;
            };
            skip.store(false, Ordering::SeqCst);

            let job_id = job.id.clone();
            let app_job = app.clone();
            let cancel_job = cancel.clone();
            let skip_job = skip.clone();

            // Heavy filesystem work runs on the blocking pool; the async worker
            // only orchestrates and emits events — never one job in parallel.
            let result = tauri::async_runtime::spawn_blocking(move || {
                let pid = job.id.clone();
                let mut low_gain_sent = false;
                compression::compress(
                    &PathBuf::from(&job.path),
                    job.algorithm,
                    job.skip_low_gain,
                    cancel_job,
                    skip_job,
                    |p| {
                        let _ = app_job.emit(
                            "compress://progress",
                            ProgressEvent {
                                job_id: pid.clone(),
                                processed: p.processed,
                                total: p.total,
                                compressed: p.compressed_so_far,
                                files_processed: p.files_processed,
                            },
                        );
                        if !low_gain_sent && p.processed >= LOW_GAIN_PROBE_BYTES {
                            let savings = 1.0 - (p.compressed_so_far as f32 / p.processed as f32);
                            if savings < LOW_GAIN_THRESHOLD {
                                low_gain_sent = true;
                                let _ = app_job.emit(
                                    "compress://low-gain",
                                    LowGainEvent {
                                        job_id: pid.clone(),
                                        savings_ratio: savings,
                                    },
                                );
                            }
                        }
                    },
                )
            })
            .await;

            match result {
                Ok(Ok(outcome)) => {
                    crate::persist::record_outcome(&app, &outcome);
                    let telemetry_on = app
                        .state::<AppState>()
                        .settings
                        .lock()
                        .map(|s| s.telemetry_enabled)
                        .unwrap_or(true);
                    if outcome.files_processed > 0 && telemetry_on {
                        let report = crate::telemetry::report_from_outcome(&app, &outcome);
                        tauri::async_runtime::spawn(async move {
                            crate::telemetry::send_report(report).await;
                        });
                    }
                    let _ = app.emit(
                        "compress://job-done",
                        JobDoneEvent {
                            job_id: job_id.clone(),
                            outcome,
                        },
                    );
                }
                // Whole-queue cancel: stop without an error event.
                Ok(Err(FolditError::Cancelled)) => break,
                Ok(Err(e)) => {
                    let _ = app.emit(
                        "compress://job-error",
                        JobErrorEvent {
                            job_id: job_id.clone(),
                            message: e.to_string(),
                        },
                    );
                }
                Err(join_err) => {
                    let _ = app.emit(
                        "compress://job-error",
                        JobErrorEvent {
                            job_id: job_id.clone(),
                            message: format!("task failed: {join_err}"),
                        },
                    );
                }
            }
        }
        running.store(false, Ordering::SeqCst);
        let _ = app.emit("compress://queue-done", ());
    });
}

/// Run a blocking filesystem job off the async runtime so the UI never stalls.
async fn run_blocking<T, F>(f: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| FolditError::Task(e.to_string()))?
}
