//! Explorer right-click integration: a "Compress with Foldit" entry on folders.
//!
//! Lives under HKEY_CURRENT_USER (no admin needed). The verb runs
//! `foldit.exe --compress "%V"` where %V is the right-clicked folder.

use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const KEY: &str = r"Software\Classes\Directory\shell\Foldit";
const LABEL: &str = "Comprimi con Foldit";

pub fn register(exe: &str) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (verb, _) = hkcu.create_subkey(KEY)?;
    verb.set_value("", &LABEL)?;
    verb.set_value("Icon", &format!("\"{exe}\",0"))?;
    let (command, _) = hkcu.create_subkey(format!(r"{KEY}\command"))?;
    command.set_value("", &format!("\"{exe}\" --compress \"%V\""))?;
    Ok(())
}

pub fn unregister() -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    // Removes the verb and its `command` subkey; ignore "not found".
    match hkcu.delete_subkey_all(KEY) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

pub fn is_registered() -> bool {
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(KEY).is_ok()
}
