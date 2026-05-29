//! Thin, safe wrappers over the Windows Overlay Filter (WOF) file-compression
//! API. We talk to NTFS directly rather than shelling out to `compact.exe`,
//! which avoids spawning a process per file and — crucially — avoids parsing
//! `compact.exe`'s localized stdout (it is translated on non-English Windows).

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, GENERIC_READ, GENERIC_WRITE, HANDLE,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetCompressedFileSizeW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
};
use windows::Win32::System::Ioctl::FSCTL_DELETE_EXTERNAL_BACKING;
use windows::Win32::System::IO::DeviceIoControl;

use crate::compression::algorithm::Algorithm;
use crate::error::{FolditError, Result};

const WOF_PROVIDER_FILE: u32 = 2;
const WOF_CURRENT_VERSION: u32 = 1;
const FILE_PROVIDER_CURRENT_VERSION: u32 = 1;
const INVALID_FILE_SIZE: u32 = 0xFFFF_FFFF;

// HRESULT_FROM_WIN32 of the "nothing to undo" cases — benign for decompress.
const ERROR_OBJECT_NOT_EXTERNALLY_BACKED: i32 = 0x8007_1126u32 as i32;
const ERROR_NOT_FOUND: i32 = 0x8007_0490u32 as i32;

#[repr(C)]
struct WofExternalInfo {
    version: u32,
    provider: u32,
}

#[repr(C)]
struct FileProviderExternalInfoV1 {
    version: u32,
    algorithm: u32,
    flags: u32,
}

#[repr(C)]
struct WofFileInfo {
    wof: WofExternalInfo,
    file: FileProviderExternalInfoV1,
}

// Declared manually: the WOF helpers have historically had patchy coverage in
// the `windows` crate, so we bind WofUtil.dll directly to stay version-proof.
#[link(name = "WofUtil")]
extern "system" {
    fn WofSetFileDataLocation(
        file_handle: HANDLE,
        provider: u32,
        external_file_info: *const c_void,
        length: u32,
    ) -> i32; // HRESULT

    fn WofIsExternalFile(
        file_path: PCWSTR,
        is_external_file: *mut i32,
        provider: *mut u32,
        external_file_info: *mut c_void,
        buffer_length: *mut u32,
    ) -> i32; // HRESULT
}

/// UTF-16, NUL-terminated path. Absolute paths get the `\\?\` extended-length
/// prefix so deep game directories beyond MAX_PATH still resolve.
fn wide_path(path: &Path) -> Vec<u16> {
    let raw: Vec<u16> = path.as_os_str().encode_wide().collect();
    let is_prefixed = raw.starts_with(&[0x5C, 0x5C, 0x3F, 0x5C]); // \\?\
    if path.is_absolute() && !is_prefixed {
        let mut out: Vec<u16> = vec![0x5C, 0x5C, 0x3F, 0x5C];
        // Extended-length paths require backslash separators.
        out.extend(raw.iter().map(|&c| if c == 0x2F { 0x5C } else { c }));
        out.push(0);
        out
    } else {
        let mut out = raw;
        out.push(0);
        out
    }
}

// HRESULT_FROM_WIN32 of the common per-file failures we want to report nicely.
const ERROR_ACCESS_DENIED: i32 = 0x8007_0005u32 as i32;
const ERROR_SHARING_VIOLATION: i32 = 0x8007_0020u32 as i32;

fn open_rw(path: &Path) -> Result<HANDLE> {
    let wide = wide_path(path);
    unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            (GENERIC_READ | GENERIC_WRITE).0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            HANDLE::default(),
        )
        .map_err(|e| match e.code().0 {
            ERROR_ACCESS_DENIED => FolditError::AccessDenied(path.display().to_string()),
            ERROR_SHARING_VIOLATION => FolditError::FileLocked(path.display().to_string()),
            code => FolditError::WinApi(format!(
                "CreateFileW failed ({code:#010X}) for {}",
                path.display()
            )),
        })
    }
}

/// Apply transparent WOF compression to a single file with the given algorithm.
pub fn compress_file(path: &Path, algo: Algorithm) -> Result<()> {
    let handle = open_rw(path)?;
    let info = WofFileInfo {
        wof: WofExternalInfo {
            version: WOF_CURRENT_VERSION,
            provider: WOF_PROVIDER_FILE,
        },
        file: FileProviderExternalInfoV1 {
            version: FILE_PROVIDER_CURRENT_VERSION,
            algorithm: algo.wof_code(),
            flags: 0,
        },
    };
    let hr = unsafe {
        WofSetFileDataLocation(
            handle,
            WOF_PROVIDER_FILE,
            &info as *const _ as *const c_void,
            std::mem::size_of::<WofFileInfo>() as u32,
        )
    };
    unsafe {
        let _ = CloseHandle(handle);
    }
    if hr < 0 {
        return Err(FolditError::WinApi(format!(
            "WofSetFileDataLocation failed (0x{hr:08X}) for {}",
            path.display()
        )));
    }
    Ok(())
}

/// Remove WOF backing from a file, restoring it to its uncompressed form.
/// Files that were never compressed are treated as a no-op success.
pub fn decompress_file(path: &Path) -> Result<()> {
    let handle = open_rw(path)?;
    let result = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_DELETE_EXTERNAL_BACKING,
            None,
            0,
            None,
            0,
            None,
            None,
        )
    };
    unsafe {
        let _ = CloseHandle(handle);
    }
    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            let code = e.code().0;
            if code == ERROR_OBJECT_NOT_EXTERNALLY_BACKED || code == ERROR_NOT_FOUND {
                Ok(())
            } else {
                Err(FolditError::WinApi(format!(
                    "FSCTL_DELETE_EXTERNAL_BACKING failed ({code:#010X}) for {}",
                    path.display()
                )))
            }
        }
    }
}

/// Returns the algorithm a file is currently WOF-compressed with, or `None`.
pub fn query_file(path: &Path) -> Result<Option<Algorithm>> {
    let wide = wide_path(path);
    let mut is_external: i32 = 0;
    let mut provider: u32 = 0;
    let mut info = FileProviderExternalInfoV1 {
        version: 0,
        algorithm: 0,
        flags: 0,
    };
    let mut len = std::mem::size_of::<FileProviderExternalInfoV1>() as u32;
    let hr = unsafe {
        WofIsExternalFile(
            PCWSTR(wide.as_ptr()),
            &mut is_external,
            &mut provider,
            &mut info as *mut _ as *mut c_void,
            &mut len,
        )
    };
    if hr < 0 {
        return Err(FolditError::WinApi(format!(
            "WofIsExternalFile failed (0x{hr:08X}) for {}",
            path.display()
        )));
    }
    if is_external == 0 || provider != WOF_PROVIDER_FILE {
        return Ok(None);
    }
    Ok(Algorithm::from_wof_code(info.algorithm))
}

/// Actual size occupied on disk (post-compression), via GetCompressedFileSizeW.
pub fn physical_size(path: &Path) -> Result<u64> {
    let wide = wide_path(path);
    let mut high: u32 = 0;
    let low = unsafe { GetCompressedFileSizeW(PCWSTR(wide.as_ptr()), Some(&mut high)) };
    if low == INVALID_FILE_SIZE {
        let err = unsafe { GetLastError() };
        if err.0 != 0 {
            return Err(FolditError::WinApi(format!(
                "GetCompressedFileSizeW failed ({:#010X}) for {}",
                err.0,
                path.display()
            )));
        }
    }
    Ok(((high as u64) << 32) | low as u64)
}
