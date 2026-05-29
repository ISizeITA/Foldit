pub mod presets;

use std::path::{Path, PathBuf};

use crate::compression;
use crate::models::{FolderAnalysis, GameEntry};

/// System subfolders of Program Files that aren't user apps — skipped to keep
/// the scan results clean (some are also access-denied).
const SYSTEM_FOLDERS: &[&str] = &[
    "WindowsApps",
    "ModifiableWindowsApps",
    "Common Files",
    "Internet Explorer",
    "Windows Defender",
    "Windows Defender Advanced Threat Protection",
    "Windows Mail",
    "Windows Media Player",
    "Windows Multimedia Platform",
    "Windows NT",
    "Windows Photo Viewer",
    "Windows Portable Devices",
    "Windows Security",
    "Windows Sidebar",
    "WindowsPowerShell",
    "Uninstall Information",
];

/// Each immediate subdirectory of a scanned root is treated as one
/// game/program. Roots themselves are launcher folders (e.g. steamapps/common).
pub fn scan(roots: &[String], mut on_progress: impl FnMut(usize, usize, &str)) -> Vec<GameEntry> {
    let mut folders: Vec<PathBuf> = Vec::new();
    for root in roots {
        let Ok(read_dir) = std::fs::read_dir(Path::new(root)) else {
            continue;
        };
        for entry in read_dir.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if SYSTEM_FOLDERS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
                continue;
            }
            folders.push(entry.path());
        }
    }

    let total = folders.len();
    let mut entries = Vec::with_capacity(total);
    for (i, folder) in folders.into_iter().enumerate() {
        let name = folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        on_progress(i + 1, total, &name);
        if let Ok(analysis) = compression::analyze(&folder) {
            entries.push(to_entry(name, analysis));
        }
    }
    entries
}

fn to_entry(name: String, a: FolderAnalysis) -> GameEntry {
    let status = if a.compressed_files > 0 {
        if a.compressed_files >= a.file_count {
            a.dominant_algorithm.clone().unwrap_or_else(|| "partial".to_string())
        } else {
            "partial".to_string()
        }
    } else if a.ntfs_compressed_files > 0 {
        // Already compressed with legacy NTFS (LZNT1), but not with Foldit's WOF.
        "ntfs".to_string()
    } else {
        "uncompressed".to_string()
    };
    GameEntry {
        name,
        path: a.path,
        logical_size: a.logical_size,
        physical_size: a.physical_size,
        savings_ratio: a.savings_ratio,
        file_count: a.file_count,
        compressed_files: a.compressed_files,
        status,
    }
}
