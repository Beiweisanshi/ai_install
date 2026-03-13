use std::cmp::Ordering;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use glob::glob;
use regex::Regex;
use semver::Version;

use super::locate_packages_dir;
#[cfg(target_os = "windows")]
use super::windows::{hidden_command, refresh_path_win};
use crate::types::{DetectResult, TOOLS};
#[cfg(not(target_os = "windows"))]
use std::process::Command;

const DETECT_TIMEOUT: Duration = Duration::from_secs(5);
const VERSION_PATTERN: &str = r"v?(\d+\.\d+\.\d+)";
const FILE_VERSION_PATTERN: &str = r"(\d+\.\d+\.\d+)";
const NPM_REGISTRY: &str = "https://registry.npmmirror.com/";

pub fn detect_tool_version(cmd: &str, args: &[&str]) -> Option<String> {
    let output = command_output_with_timeout(cmd, args, DETECT_TIMEOUT)?;
    if !output.status.success() {
        return None;
    }

    let regex = Regex::new(VERSION_PATTERN).ok()?;
    extract_version(&regex, &output.stdout).or_else(|| extract_version(&regex, &output.stderr))
}

pub fn parse_version_from_filename(filename: &str) -> Option<String> {
    let regex = Regex::new(FILE_VERSION_PATTERN).ok()?;
    regex
        .captures(filename)
        .and_then(|captures| captures.get(1).map(|matched| matched.as_str().to_string()))
}

pub fn compare_semver(current: &str, available: &str) -> Ordering {
    match (parse_semver(current), parse_semver(available)) {
        (Some(current_version), Some(available_version)) => current_version.cmp(&available_version),
        _ => Ordering::Equal,
    }
}

pub fn get_available_version_from_packages(tool_name: &str, packages_dir: &Path) -> Option<String> {
    let patterns: &[&str] = match tool_name {
        "Nushell" => &["nushell-*.msi", "nushell-*.tar.gz"],
        "Git" => &["Git-*-64-bit.exe", "git-*.pkg"],
        "Node.js" => &["node-*.msi", "node-*.pkg"],
        "CC-Switch" => &["CC-Switch*.msi", "CC-Switch*.tar.gz", "CC-Switch*.dmg", "*cc-switch*"],
        _ => return None,
    };

    let mut best_version: Option<String> = None;

    for search_dir in package_search_dirs(packages_dir) {
        for pattern in patterns {
            let glob_pattern = search_dir
                .join(pattern)
                .to_string_lossy()
                .replace('\\', "/");
            let Ok(entries) = glob(&glob_pattern) else {
                continue;
            };

            for entry in entries.flatten() {
                let Some(filename) = entry.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };

                let Some(version) = parse_version_from_filename(filename) else {
                    continue;
                };

                if is_newer_version(best_version.as_deref(), &version) {
                    best_version = Some(version);
                }
            }
        }
    }

    best_version
}

pub fn get_npm_available_version(pkg: &str) -> Option<String> {
    let url = format!("{}{}/latest", NPM_REGISTRY, encode_npm_package(pkg));

    #[cfg(target_os = "windows")]
    {
        if let Some(version) = get_npm_available_version_powershell(&url) {
            return Some(version);
        }

        get_npm_available_version_curl(&url, "curl.exe")
    }

    #[cfg(not(target_os = "windows"))]
    {
        get_npm_available_version_curl(&url, "curl")
    }
}

pub fn detect_all_tools(packages_dir: Option<&Path>) -> Vec<DetectResult> {
    #[cfg(target_os = "windows")]
    let _ = refresh_path_win();

    let resolved_packages_dir = packages_dir
        .map(PathBuf::from)
        .or_else(|| locate_packages_dir().ok());

    TOOLS
        .iter()
        .map(|tool| {
            let (installed, current_version) = if tool.name == "CC-Switch" {
                let version = detect_tool_version(tool.cmd, tool.version_args);
                let found = cc_switch_installed() || version.is_some();
                (found, version)
            } else {
                let version = detect_tool_version(tool.cmd, tool.version_args);
                (version.is_some(), version)
            };

            let available_version = match tool.npm_pkg {
                Some(pkg) => get_npm_available_version(pkg),
                None => resolved_packages_dir
                    .as_deref()
                    .and_then(|dir| get_available_version_from_packages(tool.name, dir)),
            };

            let (installable, unavailable_reason) = installability(
                tool.npm_pkg.is_some(),
                installed,
                available_version.as_deref(),
            );

            let upgradable = match (current_version.as_deref(), available_version.as_deref()) {
                (Some(current), Some(available)) => {
                    compare_semver(current, available) == Ordering::Less
                }
                _ => false,
            };

            DetectResult {
                name: tool.name.to_string(),
                installed,
                current_version,
                available_version,
                upgradable,
                installable,
                unavailable_reason,
            }
        })
        .collect()
}

fn installability(
    is_npm_tool: bool,
    installed: bool,
    available_version: Option<&str>,
) -> (bool, Option<String>) {
    if installed || is_npm_tool || available_version.is_some() {
        return (true, None);
    }

    (false, Some("Missing local package".to_string()))
}

fn command_output_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<Output> {
    #[cfg(target_os = "windows")]
    {
        return command_output_with_timeout_windows(program, args, timeout);
    }

    #[cfg(not(target_os = "windows"))]
    {
        spawn_with_timeout(program, args, timeout)
    }
}

#[cfg(target_os = "windows")]
fn command_output_with_timeout_windows(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Option<Output> {
    for candidate in [
        format!("{program}.cmd"),
        format!("{program}.exe"),
        program.to_string(),
    ] {
        if let Some(output) = spawn_with_timeout(&candidate, args, timeout) {
            return Some(output);
        }
    }

    None
}

fn spawn_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<Output> {
    #[cfg(target_os = "windows")]
    let mut command = hidden_command(program);

    #[cfg(not(target_os = "windows"))]
    let mut command = Command::new(program);

    let mut child = command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    let started_at = Instant::now();

    loop {
        match child.try_wait().ok()? {
            Some(_) => return child.wait_with_output().ok(),
            None if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn extract_version(regex: &Regex, output: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(output);
    regex
        .captures(&text)
        .and_then(|captures| captures.get(1).map(|matched| matched.as_str().to_string()))
}

fn parse_semver(value: &str) -> Option<Version> {
    let regex = Regex::new(VERSION_PATTERN).ok()?;
    let captures = regex.captures(value)?;
    let version = captures.get(1)?.as_str();
    Version::parse(version).ok()
}

fn package_search_dirs(packages_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![packages_dir.to_path_buf()];
    for child in ["windows", "macos"] {
        let child_dir = packages_dir.join(child);
        if child_dir.is_dir() {
            dirs.push(child_dir);
        }
    }
    dirs
}

fn is_newer_version(current: Option<&str>, candidate: &str) -> bool {
    match current {
        Some(version) => compare_semver(version, candidate) == Ordering::Less,
        None => true,
    }
}

fn encode_npm_package(pkg: &str) -> String {
    pkg.replace('@', "%40").replace('/', "%2F")
}

#[cfg(target_os = "windows")]
fn get_npm_available_version_powershell(url: &str) -> Option<String> {
    let script = format!(
        "$ProgressPreference='SilentlyContinue'; try {{ $resp = Invoke-RestMethod -Uri '{url}' -TimeoutSec 5 -ErrorAction Stop; if ($resp.version) {{ $resp.version }} }} catch {{ '' }}"
    );

    let output = command_output_with_timeout(
        "powershell",
        &["-NoProfile", "-Command", &script],
        DETECT_TIMEOUT,
    )?;
    if !output.status.success() {
        return None;
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn get_npm_available_version_curl(url: &str, curl_program: &str) -> Option<String> {
    let output = command_output_with_timeout(
        curl_program,
        &["-fsSL", "--max-time", "5", url],
        DETECT_TIMEOUT,
    )?;
    if !output.status.success() {
        return None;
    }

    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    value
        .get("version")
        .and_then(|version| version.as_str())
        .map(ToString::to_string)
}

fn cc_switch_installed() -> bool {
    if let Some(path) = cc_switch_windows_path() {
        if path.is_file() {
            return true;
        }
    }

    if cfg!(target_os = "macos") {
        return glob("/Applications/*[Cc][Cc]*[Ss]witch*.app")
            .ok()
            .is_some_and(|entries| entries.flatten().any(|path| path.exists()));
    }

    false
}

fn cc_switch_windows_path() -> Option<PathBuf> {
    let local_app_data = env::var_os("LOCALAPPDATA")?;
    let programs_dir = PathBuf::from(local_app_data).join("Programs");

    [
        programs_dir.join("CC Switch").join("cc-switch.exe"),
        programs_dir.join("CC Switch").join("CC Switch.exe"),
        programs_dir.join("cc-switch").join("cc-switch.exe"),
        programs_dir.join("cc-switch").join("CC Switch.exe"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use regex::Regex;

    use super::{
        VERSION_PATTERN, compare_semver, extract_version, installability,
        parse_version_from_filename,
    };

    #[test]
    fn test_detect_tool_version_regex() {
        let regex = Regex::new(VERSION_PATTERN).expect("valid version regex");

        assert_eq!(
            extract_version(&regex, b"v1.2.3"),
            Some("1.2.3".to_string())
        );
        assert_eq!(extract_version(&regex, b"1.2.3"), Some("1.2.3".to_string()));
        assert_eq!(
            extract_version(&regex, b"git version 2.53.0"),
            Some("2.53.0".to_string())
        );
    }

    #[test]
    fn test_parse_version_from_filename() {
        assert_eq!(
            parse_version_from_filename("node-v24.14.0-x64.msi"),
            Some("24.14.0".to_string())
        );
        assert_eq!(
            parse_version_from_filename("Git-2.53.0-64-bit.exe"),
            Some("2.53.0".to_string())
        );
        assert_eq!(
            parse_version_from_filename("nushell-0.102.0-x86_64-windows-msvc-full.msi"),
            Some("0.102.0".to_string())
        );
    }

    #[test]
    fn test_compare_semver() {
        assert_eq!(compare_semver("1.0.0", "2.0.0"), Ordering::Less);
        assert_eq!(compare_semver("1.2.3", "1.2.3"), Ordering::Equal);
        assert_eq!(compare_semver("2.0.0", "1.9.9"), Ordering::Greater);
        assert_eq!(compare_semver("invalid", "2.0.0"), Ordering::Equal);
    }

    #[test]
    fn test_installability_for_missing_local_package() {
        let (installable, unavailable_reason) = installability(false, false, None);

        assert!(!installable);
        assert_eq!(unavailable_reason.as_deref(), Some("Missing local package"));
    }

    #[test]
    fn test_installability_for_npm_tool_without_detected_version() {
        let (installable, unavailable_reason) = installability(true, false, None);

        assert!(installable);
        assert!(unavailable_reason.is_none());
    }
}
