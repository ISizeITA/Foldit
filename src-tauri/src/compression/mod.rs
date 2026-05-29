pub mod algorithm;
pub mod exclusions;
pub mod wof;

use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use algorithm::Algorithm;

use crate::error::{FolditError, Result};
use crate::models::{CompressionOutcome, FolderAnalysis};

/// Legacy NTFS compression flag (FILE_ATTRIBUTE_COMPRESSED). WOF-compressed
/// files do NOT carry this flag, so the two mechanisms are distinguishable.
const FILE_ATTRIBUTE_COMPRESSED: u32 = 0x0000_0800;

// Cloud/offline placeholder flags — touching these can force a download, so we
// skip them (OneDrive Files On-Demand, archived/offline files, ...).
const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

fn is_cloud_or_offline(attrs: u32) -> bool {
    attrs
        & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
        != 0
}

/// Files at/below one NTFS cluster can't drop below a cluster on disk, so WOF
/// can't help — skip them (also avoids per-file WOF overhead on tiny files).
const MIN_FILE_SIZE: u64 = 4096;
/// When `skip_low_gain` is on, revert files that save less than this fraction.
const MIN_GAIN: f32 = 0.05;

/// Live progress emitted while a folder is being compressed.
pub struct CompressionProgress {
    pub processed: u64,
    pub total: u64,
    pub compressed_so_far: u64,
    pub files_processed: u64,
}

/// Walk a folder and report its current size + compression state.
pub fn analyze(root: &Path) -> Result<FolderAnalysis> {
    if !root.exists() {
        return Err(FolditError::NotFound(root.display().to_string()));
    }

    let mut logical = 0u64;
    let mut physical = 0u64;
    let mut file_count = 0u64;
    let mut compressed_files = 0u64;
    let mut ntfs_compressed_files = 0u64;
    let mut tally = [0u64; 4];

    for entry in jwalk::WalkDir::new(root).skip_hidden(false) {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let len = meta.len();
        logical += len;
        physical += wof::physical_size(&path).unwrap_or(len);
        file_count += 1;
        if let Some(algo) = wof::query_file(&path).ok().flatten() {
            compressed_files += 1;
            tally[algo.index()] += 1;
        } else if meta.file_attributes() & FILE_ATTRIBUTE_COMPRESSED != 0 {
            ntfs_compressed_files += 1;
        }
    }

    let dominant_algorithm = if compressed_files > 0 {
        let (idx, _) = tally
            .iter()
            .enumerate()
            .max_by_key(|(_, count)| **count)
            .unwrap();
        Some(Algorithm::from_index(idx).name().to_string())
    } else {
        None
    };

    let savings_ratio = if logical > 0 {
        1.0 - (physical as f32 / logical as f32)
    } else {
        0.0
    };

    Ok(FolderAnalysis {
        path: root.display().to_string(),
        logical_size: logical,
        physical_size: physical,
        file_count,
        compressed_files,
        ntfs_compressed_files,
        dominant_algorithm,
        savings_ratio,
    })
}

/// Compress every eligible file under `root` with `algo`, in place.
/// `cancel` is polled between files; `on_progress` runs after each file.
pub fn compress(
    root: &Path,
    algo: Algorithm,
    skip_low_gain: bool,
    cancel: Arc<AtomicBool>,
    skip: Arc<AtomicBool>,
    mut on_progress: impl FnMut(CompressionProgress),
) -> Result<CompressionOutcome> {
    if !root.exists() {
        return Err(FolditError::NotFound(root.display().to_string()));
    }

    // First pass: classify every file. We compress only "eligible" files
    // (already-compressed media/archives are skipped), but size accounting
    // covers the WHOLE folder so the reported savings reflect the real game.
    let mut eligible: Vec<(PathBuf, u64)> = Vec::new();
    let mut eligible_logical = 0u64;
    let mut whole_logical = 0u64;
    let mut excluded_logical = 0u64;
    let mut files_skipped = 0u64;
    for entry in jwalk::WalkDir::new(root).skip_hidden(false) {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        let len = meta.len();
        whole_logical += len;
        // Skip already-compressed types, tiny files, and cloud/offline placeholders.
        if len < MIN_FILE_SIZE
            || is_cloud_or_offline(meta.file_attributes())
            || exclusions::is_excluded(&path)
        {
            excluded_logical += len;
            files_skipped += 1;
            continue;
        }
        eligible_logical += len;
        eligible.push((path, len));
    }

    // Second pass: compress eligible files one at a time. Progress is reported
    // against the eligible bytes (the actual work being done).
    let mut processed = 0u64;
    let mut eligible_compressed = 0u64;
    let mut files_processed = 0u64;
    let mut access_denied = 0u64;
    let mut files_locked = 0u64;
    let mut files_failed = 0u64;
    for (path, len) in eligible {
        if cancel.load(Ordering::Relaxed) {
            return Err(FolditError::Cancelled);
        }
        // Skip ends this folder early but keeps the queue going.
        if skip.load(Ordering::Relaxed) {
            break;
        }
        // Only touch files that aren't already at the target algorithm.
        let apply = match wof::query_file(&path) {
            Ok(Some(current)) if current == algo => Ok(()),
            Ok(Some(_)) => {
                let _ = wof::decompress_file(&path);
                wof::compress_file(&path, algo)
            }
            _ => wof::compress_file(&path, algo),
        };
        match apply {
            Ok(()) => {
                let phys = wof::physical_size(&path).unwrap_or(len);
                let gain = if len > 0 { 1.0 - (phys as f32 / len as f32) } else { 0.0 };
                if skip_low_gain && gain < MIN_GAIN {
                    // Not worth it — revert so the file stays uncompressed.
                    let _ = wof::decompress_file(&path);
                    eligible_compressed += len;
                    files_skipped += 1;
                } else {
                    eligible_compressed += phys;
                    files_processed += 1;
                }
            }
            Err(FolditError::AccessDenied(_)) => {
                access_denied += 1;
                eligible_compressed += len;
            }
            Err(FolditError::FileLocked(_)) => {
                files_locked += 1;
                eligible_compressed += len;
            }
            Err(_) => {
                files_failed += 1;
                eligible_compressed += len;
            }
        }
        processed += len;
        on_progress(CompressionProgress {
            processed,
            total: eligible_logical,
            compressed_so_far: eligible_compressed,
            files_processed,
        });
    }

    // Eligible files not reached (early skip) keep their original size; excluded
    // files are counted at full size. Total reflects the entire folder.
    let eligible_remaining = eligible_logical.saturating_sub(processed);
    let compressed_total = excluded_logical + eligible_compressed + eligible_remaining;
    let original_total = whole_logical;
    let saved_bytes = original_total.saturating_sub(compressed_total);
    let ratio = if original_total > 0 {
        compressed_total as f32 / original_total as f32
    } else {
        1.0
    };

    Ok(CompressionOutcome {
        path: root.display().to_string(),
        algorithm: algo.name().to_string(),
        original_size: original_total,
        compressed_size: compressed_total,
        saved_bytes,
        ratio,
        files_processed,
        files_skipped,
        access_denied,
        files_locked,
        files_failed,
    })
}

/// Rollback: remove WOF backing from every file under `root`, then re-analyze.
pub fn decompress(root: &Path) -> Result<FolderAnalysis> {
    if !root.exists() {
        return Err(FolditError::NotFound(root.display().to_string()));
    }
    for entry in jwalk::WalkDir::new(root).skip_hidden(false) {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let _ = wof::decompress_file(&entry.path());
    }
    analyze(root)
}
