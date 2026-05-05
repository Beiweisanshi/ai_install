use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use semver::Version;
use serde::Deserialize;
#[cfg(not(target_os = "windows"))]
use std::process::Command;

#[cfg(target_os = "windows")]
use crate::installer::windows::hidden_command;
use crate::types::AppVersionInfo;

const VERSION_METADATA_FILE: &str = "app-version.json";

#[derive(Debug, Deserialize)]
struct VersionMetadata {
    latest_version: Option<String>,
    download_url: Option<String>,
    release_url: Option<String>,
}

pub fn get_app_version_info() -> AppVersionInfo {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let metadata = load_version_metadata();
    let latest_version = metadata
        .as_ref()
        .and_then(|value| normalize_optional_string(value.latest_version.as_deref()));
    let download_url = metadata
        .as_ref()
        .and_then(|value| normalize_optional_string(value.download_url.as_deref()));
    let release_url = metadata
        .as_ref()
        .and_then(|value| normalize_optional_string(value.release_url.as_deref()))
        .or_else(|| download_url.clone());
    let upgrade_available = latest_version
        .as_deref()
        .is_some_and(|latest| is_newer_version(&current_version, latest));

    AppVersionInfo {
        current_version,
        latest_version,
        upgrade_available,
        download_url,
        release_url,
    }
}

fn load_version_metadata() -> Option<VersionMetadata> {
    if let Some(url) = configured_version_url() {
        if let Some(metadata) = load_version_metadata_from_url(&url) {
            return Some(metadata);
        }
    }

    for candidate in metadata_candidates() {
        if !candidate.is_file() {
            continue;
        }

        let Ok(content) = fs::read_to_string(&candidate) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<VersionMetadata>(&content) else {
            continue;
        };
        return Some(parsed);
    }

    None
}

fn configured_version_url() -> Option<String> {
    normalize_optional_string(env::var("GUI_INSTALLER_VERSION_URL").ok().as_deref())
        .or_else(|| normalize_optional_string(option_env!("GUI_INSTALLER_VERSION_URL")))
}

fn load_version_metadata_from_url(url: &str) -> Option<VersionMetadata> {
    #[cfg(target_os = "windows")]
    {
        return load_version_metadata_from_url_windows(url);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("curl")
            .args(["-fsSL", "--max-time", "5", url])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        serde_json::from_slice(&output.stdout).ok()
    }
}

#[cfg(target_os = "windows")]
fn load_version_metadata_from_url_windows(url: &str) -> Option<VersionMetadata> {
    let script = format!(
        "$ProgressPreference='SilentlyContinue'; try {{ Invoke-RestMethod -Uri '{url}' -TimeoutSec 5 | ConvertTo-Json -Compress -Depth 4 }} catch {{ '' }}"
    );

    let output = hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    serde_json::from_slice(&output.stdout).ok()
}

fn metadata_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = env::var("GUI_INSTALLER_VERSION_FILE") {
        push_candidate(&mut candidates, PathBuf::from(path));
    }

    if let Ok(current_exe) = env::current_exe() {
        push_nearby_candidates(&mut candidates, &current_exe);
    }

    if let Ok(current_dir) = env::current_dir() {
        push_candidate(&mut candidates, current_dir.join(VERSION_METADATA_FILE));
        push_candidate(
            &mut candidates,
            current_dir.join("dist").join(VERSION_METADATA_FILE),
        );

        if let Some(parent) = current_dir.parent() {
            push_candidate(&mut candidates, parent.join(VERSION_METADATA_FILE));
            push_candidate(
                &mut candidates,
                parent.join("dist").join(VERSION_METADATA_FILE),
            );
        }
    }

    candidates
}

fn push_nearby_candidates(candidates: &mut Vec<PathBuf>, current_exe: &Path) {
    if let Some(exe_dir) = current_exe.parent() {
        push_candidate(candidates, exe_dir.join(VERSION_METADATA_FILE));
        push_candidate(candidates, exe_dir.join("dist").join(VERSION_METADATA_FILE));

        if let Some(parent) = exe_dir.parent() {
            push_candidate(candidates, parent.join(VERSION_METADATA_FILE));
            push_candidate(candidates, parent.join("dist").join(VERSION_METADATA_FILE));
        }
    }
}

fn push_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_version(current), parse_version(latest)) {
        (Some(current), Some(latest)) => latest > current,
        _ => latest.trim() != current.trim(),
    }
}

fn parse_version(value: &str) -> Option<Version> {
    Version::parse(value.trim_start_matches('v').trim()).ok()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{VersionMetadata, is_newer_version, load_version_metadata, push_candidate};

    fn test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn unique_temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!(
            "gui-installer-version-tests-{}-{nanos}",
            std::process::id()
        ))
    }

    #[test]
    fn test_is_newer_version() {
        assert!(is_newer_version("0.1.0", "0.2.0"));
        assert!(is_newer_version("v0.1.0", "0.2.0"));
        assert!(!is_newer_version("0.2.0", "0.2.0"));
    }

    #[test]
    fn test_push_candidate_deduplicates() {
        let mut candidates = Vec::new();
        let path = PathBuf::from("D:/tmp/app-version.json");

        push_candidate(&mut candidates, path.clone());
        push_candidate(&mut candidates, path);

        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn test_load_version_metadata_from_env_file() {
        let _guard = test_lock().lock().expect("lock tests");
        let dir = unique_temp_dir();
        fs::create_dir_all(&dir).expect("create temp dir");
        let metadata_path = dir.join("custom-app-version.json");
        fs::write(
            &metadata_path,
            r#"{"latest_version":"0.3.0","download_url":"https://example.com"}"#,
        )
        .expect("write metadata");

        unsafe {
            std::env::set_var("GUI_INSTALLER_VERSION_FILE", &metadata_path);
        }

        let metadata = load_version_metadata().expect("read metadata");
        assert_eq!(metadata.latest_version.as_deref(), Some("0.3.0"));
        assert_eq!(
            metadata.download_url.as_deref(),
            Some("https://example.com")
        );

        unsafe {
            std::env::remove_var("GUI_INSTALLER_VERSION_FILE");
        }
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    #[test]
    fn test_version_metadata_deserializes_optional_fields() {
        let metadata: VersionMetadata =
            serde_json::from_str(r#"{"latest_version":"0.4.0"}"#).expect("parse metadata");
        assert_eq!(metadata.latest_version.as_deref(), Some("0.4.0"));
        assert_eq!(metadata.download_url, None);
    }
}
