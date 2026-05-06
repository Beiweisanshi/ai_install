use std::fs;
use std::path::Path;

/// Write `bytes` to `path` atomically: stage to a sibling `.tmp.{pid}`, then
/// rename. On Windows, if the target is held open by another process and the
/// rename is refused, the existing file is moved aside before the rename
/// retries — the original is restored if the retry also fails.
pub fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| format!("write tmp {}: {e}", tmp.display()))?;

    if fs::rename(&tmp, path).is_ok() {
        return Ok(());
    }

    let bak = path.with_extension(format!("bak.{}", std::process::id()));
    if path.exists() {
        if let Err(e) = fs::rename(path, &bak) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("backup {} -> {}: {e}", path.display(), bak.display()));
        }
    }
    match fs::rename(&tmp, path) {
        Ok(()) => {
            if bak.exists() {
                let _ = fs::remove_file(&bak);
            }
            Ok(())
        }
        Err(rename_err) => {
            if bak.exists() {
                if let Err(restore_err) = fs::rename(&bak, path) {
                    let _ = fs::remove_file(&tmp);
                    return Err(format!(
                        "rename failed: {rename_err}; restore from {} also failed: {restore_err}",
                        bak.display()
                    ));
                }
            }
            let _ = fs::remove_file(&tmp);
            Err(format!("rename {} -> {}: {rename_err}", tmp.display(), path.display()))
        }
    }
}
