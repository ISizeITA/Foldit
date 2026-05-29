use serde::{Deserialize, Serialize};

/// NTFS transparent-compression algorithms exposed by the WOF file provider.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "UPPERCASE")]
pub enum Algorithm {
    Xpress4k,
    Xpress8k,
    Xpress16k,
    Lzx,
}

impl Algorithm {
    /// The `FILE_PROVIDER_COMPRESSION_*` code expected by the WOF API.
    /// Note: these are NOT in increasing-strength order (LZX == 1).
    pub fn wof_code(self) -> u32 {
        match self {
            Algorithm::Xpress4k => 0,
            Algorithm::Lzx => 1,
            Algorithm::Xpress8k => 2,
            Algorithm::Xpress16k => 3,
        }
    }

    pub fn from_wof_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Algorithm::Xpress4k),
            1 => Some(Algorithm::Lzx),
            2 => Some(Algorithm::Xpress8k),
            3 => Some(Algorithm::Xpress16k),
            _ => None,
        }
    }

    /// Stable 0..4 index for tally arrays (distinct from the WOF code).
    pub fn index(self) -> usize {
        match self {
            Algorithm::Xpress4k => 0,
            Algorithm::Xpress8k => 1,
            Algorithm::Xpress16k => 2,
            Algorithm::Lzx => 3,
        }
    }

    pub fn from_index(i: usize) -> Self {
        match i {
            0 => Algorithm::Xpress4k,
            1 => Algorithm::Xpress8k,
            2 => Algorithm::Xpress16k,
            _ => Algorithm::Lzx,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Algorithm::Xpress4k => "XPRESS4K",
            Algorithm::Xpress8k => "XPRESS8K",
            Algorithm::Xpress16k => "XPRESS16K",
            Algorithm::Lzx => "LZX",
        }
    }
}

impl Default for Algorithm {
    fn default() -> Self {
        Algorithm::Xpress8k
    }
}

#[cfg(test)]
mod tests {
    use super::Algorithm;

    const ALL: [Algorithm; 4] = [
        Algorithm::Xpress4k,
        Algorithm::Xpress8k,
        Algorithm::Xpress16k,
        Algorithm::Lzx,
    ];

    #[test]
    fn wof_code_roundtrips() {
        for a in ALL {
            assert_eq!(Algorithm::from_wof_code(a.wof_code()), Some(a));
        }
        // WOF codes are NOT in strength order: LZX == 1.
        assert_eq!(Algorithm::Lzx.wof_code(), 1);
        assert_eq!(Algorithm::Xpress8k.wof_code(), 2);
    }

    #[test]
    fn index_roundtrips() {
        for a in ALL {
            assert_eq!(Algorithm::from_index(a.index()), a);
        }
    }

    #[test]
    fn serializes_uppercase() {
        assert_eq!(serde_json::to_string(&Algorithm::Xpress16k).unwrap(), "\"XPRESS16K\"");
    }
}
