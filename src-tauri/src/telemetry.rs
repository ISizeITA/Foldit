//! Crowdsourced telemetry: fetch the shared database.json on demand, and POST
//! an anonymous report to the Cloudflare Worker after each successful job.

use std::path::Path;

use tauri::AppHandle;

use crate::error::{FolditError, Result};
use crate::models::{CompressionOutcome, TelemetryEntry, TelemetryReport};

// ---------------------------------------------------------------------------
// Endpoints — replace with your own (see cloudflare-worker/README.md).
//   DATABASE_URL : raw GitHub URL of the published database.json
//   TELEMETRY_URL: your deployed Cloudflare Worker URL
// ---------------------------------------------------------------------------
// Read + write both go through the Worker: GET returns the live database
// (works even for a PRIVATE repo, since the Worker reads it with the token,
// and there is no raw.githubusercontent CDN cache); POST submits a report.
const DATABASE_URL: &str = "https://foldit.laurenzaroldano.workers.dev";
const TELEMETRY_URL: &str = "https://foldit.laurenzaroldano.workers.dev";

const USER_AGENT: &str = concat!("Foldit/", env!("CARGO_PKG_VERSION"));

async fn fetch_remote() -> Result<Vec<TelemetryEntry>> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| FolditError::Network(e.to_string()))?;
    let resp = client
        .get(DATABASE_URL)
        .send()
        .await
        .map_err(|e| FolditError::Network(e.to_string()))?;
    resp.json::<Vec<TelemetryEntry>>()
        .await
        .map_err(|e| FolditError::Network(e.to_string()))
}

/// Fetch the database, caching it locally on success and falling back to the
/// cached copy when the network/Worker is unavailable.
pub async fn fetch_database(app: &AppHandle) -> Result<Vec<TelemetryEntry>> {
    match fetch_remote().await {
        Ok(entries) => {
            crate::persist::save_telemetry_cache(app, &entries);
            Ok(entries)
        }
        Err(e) => crate::persist::load_telemetry_cache(app).ok_or(e),
    }
}

pub fn report_from_outcome(app: &AppHandle, o: &CompressionOutcome) -> TelemetryReport {
    TelemetryReport {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        game_name: Path::new(&o.path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string(),
        algorithm: o.algorithm.clone(),
        original_size: o.original_size,
        compressed_size: o.compressed_size,
        ratio: o.ratio,
        file_count: o.files_processed,
        client_hash: crate::persist::client_id(app),
    }
}

/// Best-effort, fire-and-forget POST. Network failures are silently ignored.
pub async fn send_report(report: TelemetryReport) {
    let Ok(client) = reqwest::Client::builder().user_agent(USER_AGENT).build() else {
        return;
    };
    let _ = client.post(TELEMETRY_URL).json(&report).send().await;
}
