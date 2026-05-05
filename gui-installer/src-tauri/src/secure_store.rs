use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const SESSION_FILE: &str = "session.bin";

pub fn get_session(app: AppHandle) -> Result<Option<String>, String> {
    get_session_at(&session_path(&app)?)
}

pub fn set_session(app: AppHandle, session: String) -> Result<(), String> {
    set_session_at(&session_path(&app)?, &session)
}

pub fn clear_session(app: AppHandle) -> Result<(), String> {
    clear_session_at(&session_path(&app)?)
}

pub(crate) fn get_session_at(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read(path).map_err(|error| format!("Failed to read session: {error}"))?;
    let decrypted = platform::decrypt(&encrypted)?;
    let session = String::from_utf8(decrypted)
        .map_err(|error| format!("Stored session is not valid UTF-8: {error}"))?;
    Ok(Some(session))
}

pub(crate) fn set_session_at(path: &Path, session: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create session directory: {error}"))?;
    }

    let encrypted = platform::encrypt(session.as_bytes())?;
    fs::write(path, encrypted).map_err(|error| format!("Failed to write session: {error}"))
}

pub(crate) fn clear_session_at(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to remove session: {error}")),
    }
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(SESSION_FILE))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ptr::null;

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        protect(data, true)
    }

    pub fn decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        protect(data, false)
    }

    fn protect(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        let ok = unsafe {
            if encrypt {
                CryptProtectData(
                    &input,
                    null(),
                    null(),
                    null(),
                    null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    null::<*mut u16>() as *mut _,
                    null(),
                    null(),
                    null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            }
        };

        if ok == 0 {
            return Err("Windows DPAPI session encryption failed".to_string());
        }

        let bytes = unsafe {
            let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
            let copied = slice.to_vec();
            LocalFree(output.pbData as _);
            copied
        };
        Ok(bytes)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn encrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }

    pub fn decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.to_vec())
    }
}
