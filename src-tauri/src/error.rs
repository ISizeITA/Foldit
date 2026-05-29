use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum FolditError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("path not found: {0}")]
    NotFound(String),

    #[error("Windows API error: {0}")]
    WinApi(String),

    #[error("access denied: {0}")]
    AccessDenied(String),

    #[error("file in use: {0}")]
    FileLocked(String),

    #[error("network error: {0}")]
    Network(String),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("operation cancelled")]
    Cancelled,

    #[error("background task failed: {0}")]
    Task(String),
}

// Errors must cross the IPC boundary as plain strings the frontend can show.
impl Serialize for FolditError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, FolditError>;
