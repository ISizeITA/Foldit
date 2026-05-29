use tauri::AppHandle;

use crate::error::Result;
use crate::models::TelemetryEntry;
use crate::telemetry;

#[tauri::command]
pub async fn fetch_telemetry_database(app: AppHandle) -> Result<Vec<TelemetryEntry>> {
    telemetry::fetch_database(&app).await
}
