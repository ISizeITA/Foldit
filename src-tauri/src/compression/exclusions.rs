use std::path::Path;

/// Extensions whose contents are already compressed; running NTFS compression
/// over them just burns CPU for ~0% gain, so we skip them entirely.
const EXCLUDED_EXTENSIONS: &[&str] = &[
    // Archives
    "zip", "rar", "7z", "gz", "bz2", "xz", "zst", "lz4", "cab",
    // Video
    "mp4", "mkv", "avi", "mov", "webm", "wmv", "m4v", "flv",
    // Audio
    "mp3", "ogg", "flac", "aac", "m4a", "opus", "wma",
    // Images (already entropy-coded)
    "jpg", "jpeg", "png", "gif", "webp", "jxl", "heic", "ico",
    // Game media that ships pre-compressed (Bink video, Wwise/FMOD audio)
    "bik", "bk2", "wem", "fsb",
];
// NOTE: generic package containers (.pak, .arc, .assets, .bundle ...) are NOT
// excluded — they often hold uncompressed data that compresses well. When a
// container is already compressed, the runtime low-gain detector handles it.

pub fn is_excluded(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => EXCLUDED_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_excluded;
    use std::path::Path;

    #[test]
    fn excludes_media_and_archives_case_insensitive() {
        assert!(is_excluded(Path::new("clip.mp4")));
        assert!(is_excluded(Path::new("ARCHIVE.ZIP")));
        assert!(is_excluded(Path::new("sub/dir/song.flac")));
    }

    #[test]
    fn keeps_compressible_and_containers() {
        assert!(!is_excluded(Path::new("game.exe")));
        assert!(!is_excluded(Path::new("lib.dll")));
        assert!(!is_excluded(Path::new("data.pak"))); // containers are NOT excluded
        assert!(!is_excluded(Path::new("noextension")));
    }
}
