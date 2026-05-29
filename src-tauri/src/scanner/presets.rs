use std::path::{Path, PathBuf};

use crate::models::ScanPreset;

fn existing(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().filter(|p| Path::new(p).is_dir()).collect()
}

fn make(id: &str, label: &str, paths: Vec<String>) -> ScanPreset {
    ScanPreset {
        id: id.to_string(),
        label: label.to_string(),
        available: !paths.is_empty(),
        paths,
    }
}

fn env_dir(var: &str, suffix: &str) -> Option<String> {
    std::env::var(var).ok().map(|base| {
        let mut p = PathBuf::from(base);
        if !suffix.is_empty() {
            p.push(suffix);
        }
        p.to_string_lossy().to_string()
    })
}

/// Extract every library base path from a Steam `libraryfolders.vdf`.
/// Pure (no I/O) so it can be unit-tested.
pub fn parse_library_paths(vdf: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("\"path\"") else {
            continue;
        };
        // rest looks like:  \t\t"D:\\SteamLibrary"
        let mut parts = rest.trim().split('"');
        parts.next(); // text before the opening quote
        if let Some(value) = parts.next() {
            out.push(value.replace("\\\\", "\\")); // VDF escapes backslashes
        }
    }
    out
}

/// All Steam `steamapps\common` dirs, including libraries on other drives.
fn steam_common_dirs() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let candidates = [
        "C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf",
        "C:\\Program Files\\Steam\\steamapps\\libraryfolders.vdf",
    ];
    for vdf in candidates {
        let Ok(text) = std::fs::read_to_string(vdf) else {
            continue;
        };
        for base in parse_library_paths(&text) {
            let common = PathBuf::from(base).join("steamapps").join("common");
            let s = common.to_string_lossy().to_string();
            if !out.contains(&s) {
                out.push(s);
            }
        }
        break; // first existing vdf wins
    }
    let default = "C:\\Program Files (x86)\\Steam\\steamapps\\common".to_string();
    if !out.contains(&default) {
        out.push(default);
    }
    out
}

pub fn presets() -> Vec<ScanPreset> {
    let mut presets = Vec::new();

    // Game launchers
    presets.push(make("steam", "Steam", existing(steam_common_dirs())));
    presets.push(make(
        "epic",
        "Epic Games",
        existing(vec![
            "C:\\Program Files\\Epic Games".into(),
            "C:\\Program Files (x86)\\Epic Games".into(),
        ]),
    ));
    presets.push(make(
        "gog",
        "GOG",
        existing(vec![
            "C:\\Program Files (x86)\\GOG Galaxy\\Games".into(),
            "C:\\GOG Games".into(),
        ]),
    ));
    presets.push(make(
        "ea",
        "EA / Origin",
        existing(vec![
            "C:\\Program Files\\EA Games".into(),
            "C:\\Program Files\\Origin Games".into(),
            "C:\\Program Files (x86)\\Origin Games".into(),
        ]),
    ));
    presets.push(make(
        "ubisoft",
        "Ubisoft",
        existing(vec![
            "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games".into(),
        ]),
    ));
    presets.push(make("xbox", "Xbox", existing(vec!["C:\\XboxGames".into()])));
    presets.push(make("riot", "Riot Games", existing(vec!["C:\\Riot Games".into()])));
    presets.push(make(
        "rockstar",
        "Rockstar",
        existing(vec![
            "C:\\Program Files\\Rockstar Games".into(),
            "C:\\Program Files (x86)\\Rockstar Games".into(),
        ]),
    ));
    presets.push(make(
        "amazon",
        "Amazon Games",
        existing(vec!["C:\\Amazon Games\\Library".into()]),
    ));
    if let Some(p) = env_dir("LOCALAPPDATA", "itch\\apps") {
        presets.push(make("itch", "itch.io", existing(vec![p])));
    }

    // Installed programs (each immediate subfolder is treated as one program)
    let mut program_dirs = Vec::new();
    if let Some(p) = env_dir("ProgramFiles", "") {
        program_dirs.push(p);
    }
    if let Some(p) = env_dir("ProgramFiles(x86)", "") {
        program_dirs.push(p);
    }
    presets.push(make("programs", "Installed programs", existing(program_dirs)));

    if let Some(p) = env_dir("LOCALAPPDATA", "Programs") {
        presets.push(make("userPrograms", "User programs", existing(vec![p])));
    }

    presets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_library_paths_across_drives() {
        let vdf = "\
\"libraryfolders\"
{
\t\"0\"
\t{
\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"
\t}
\t\"1\"
\t{
\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"
\t}
}";
        let paths = parse_library_paths(vdf);
        assert_eq!(
            paths,
            vec![
                "C:\\Program Files (x86)\\Steam".to_string(),
                "D:\\SteamLibrary".to_string(),
            ]
        );
    }

    #[test]
    fn ignores_non_path_lines() {
        assert!(parse_library_paths("\"label\"\t\"something\"\n\"contentid\"\t\"123\"").is_empty());
    }
}
