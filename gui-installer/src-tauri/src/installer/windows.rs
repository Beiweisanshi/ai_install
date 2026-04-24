#![cfg(target_os = "windows")]

use std::cmp::Ordering;
use std::env;
use std::ffi::OsStr;
use std::io;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};
use std::time::Instant;

use glob::Pattern;
use tauri::AppHandle;
use tokio::time::{Duration, sleep};

use super::detect::{compare_semver, parse_version_from_filename};
use super::{BoxFuture, ToolInstaller, locate_packages_dir, verify_package_hash};
use crate::types::{DetectResult, InstallResult, InstallerError};

pub const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct NushellInstallerWin;

const NUSHELL_PACKAGE_PATTERN: &str = "nushell-*.msi";

impl ToolInstaller for NushellInstallerWin {
    fn name(&self) -> &str {
        "Nushell"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name(), command_version("nu", &["--version"])) })
    }

    fn target_version(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move { bundled_target_version(NUSHELL_PACKAGE_PATTERN) })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            let current = command_version("nu", &["--version"]);
            let target = bundled_target_version(NUSHELL_PACKAGE_PATTERN);
            if !is_upgrade_needed(current.as_deref(), target.as_deref()) {
                return Ok(success_result(
                    self.name(),
                    current,
                    "Nushell already up to date",
                ));
            }

            let package = find_package(&windows_packages_dir()?, NUSHELL_PACKAGE_PATTERN)?;
            verify_package_hash(&package)?;

            let status = run_msi_elevated(&package, &["/qn", "/norestart"]).map_err(|error| {
                install_failed(
                    self.name(),
                    format!(
                        "failed to launch elevated msiexec for {}: {error}",
                        package.display()
                    ),
                )
            })?;

            ensure_success(self.name(), &package, status)?;
            ensure_nushell_on_user_path()?;
            refresh_path_win()?;

            Ok(success_result(
                self.name(),
                command_version("nu", &["--version"]),
                format!("Installed Nushell from {}", package.display()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            let target = bundled_target_version(NUSHELL_PACKAGE_PATTERN);
            verify_meets_target("nu", &["--version"], target.as_deref(), 5, 3).await
        })
    }
}

pub struct GitInstallerWin;

const GIT_PACKAGE_PATTERN: &str = "Git-*-64-bit.exe";

impl ToolInstaller for GitInstallerWin {
    fn name(&self) -> &str {
        "Git"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name(), command_version("git", &["--version"])) })
    }

    fn target_version(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move { bundled_target_version(GIT_PACKAGE_PATTERN) })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            let current = command_version("git", &["--version"]);
            let target = bundled_target_version(GIT_PACKAGE_PATTERN);
            if !is_upgrade_needed(current.as_deref(), target.as_deref()) {
                return Ok(success_result(
                    self.name(),
                    current,
                    "Git already up to date",
                ));
            }

            let package = find_package(&windows_packages_dir()?, GIT_PACKAGE_PATTERN)?;
            verify_package_hash(&package)?;
            unblock_file(&package);

            let status =
                run_elevated(&package, &["/VERYSILENT", "/NORESTART"]).map_err(|error| {
                    install_failed(
                        self.name(),
                        format!(
                            "failed to launch elevated installer {}: {error}",
                            package.display()
                        ),
                    )
                })?;

            ensure_success(self.name(), &package, status)?;
            wait_installer_idle(30).await;
            refresh_path_win()?;

            // Git uses INNO Setup which may need a moment to finalize PATH registration.
            let delays = [3u64, 5, 10];
            let mut version = None;
            for delay in &delays {
                refresh_path_win()?;
                sleep(Duration::from_secs(*delay)).await;
                version = command_version("git", &["--version"]);
                if version.is_some() {
                    break;
                }
            }

            Ok(success_result(
                self.name(),
                version,
                format!("Installed Git from {}", package.display()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            let target = bundled_target_version(GIT_PACKAGE_PATTERN);
            verify_meets_target("git", &["--version"], target.as_deref(), 5, 3).await
        })
    }
}

pub struct NodeInstallerWin;

const NODE_PACKAGE_PATTERN: &str = "node-*-x64.msi";

impl ToolInstaller for NodeInstallerWin {
    fn name(&self) -> &str {
        "Node.js"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name(), command_version("node", &["--version"])) })
    }

    fn target_version(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move { bundled_target_version(NODE_PACKAGE_PATTERN) })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            let current = command_version("node", &["--version"]);
            let target = bundled_target_version(NODE_PACKAGE_PATTERN);
            if !is_upgrade_needed(current.as_deref(), target.as_deref()) {
                return Ok(success_result(
                    self.name(),
                    current,
                    "Node.js already up to date",
                ));
            }

            let package = find_package(&windows_packages_dir()?, NODE_PACKAGE_PATTERN)?;
            verify_package_hash(&package)?;

            let status = run_msi_elevated(&package, &["/qn", "/norestart"]).map_err(|error| {
                install_failed(
                    self.name(),
                    format!(
                        "failed to launch elevated msiexec for {}: {error}",
                        package.display()
                    ),
                )
            })?;

            ensure_success(self.name(), &package, status)?;
            wait_installer_idle(60).await;
            refresh_path_win()?;

            let delays = [5u64, 10, 15];
            let mut version = None;
            for delay in &delays {
                refresh_path_win()?;
                sleep(Duration::from_secs(*delay)).await;
                version = command_version("node", &["--version"]);
                if version.is_some() {
                    break;
                }
            }

            Ok(success_result(
                self.name(),
                version,
                format!("Installed Node.js from {}", package.display()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            let target = bundled_target_version(NODE_PACKAGE_PATTERN);
            verify_meets_target("node", &["--version"], target.as_deref(), 3, 5).await
        })
    }
}

pub struct CCSwitchInstallerWin;

const CC_SWITCH_PACKAGE_PATTERNS: &[&str] = &[
    "CC-Switch*.msi",
    "CC-Switch*.exe",
    "*cc-switch*.msi",
    "*cc-switch*.exe",
];

/// Return the bundled CC-Switch package path (MSI preferred, EXE fallback).
fn cc_switch_bundled_package() -> Option<PathBuf> {
    let dir = windows_packages_dir().ok()?;
    for pattern in CC_SWITCH_PACKAGE_PATTERNS {
        if let Ok(package) = find_package(&dir, pattern) {
            return Some(package);
        }
    }
    None
}

fn cc_switch_target_version_sync() -> Option<String> {
    let package = cc_switch_bundled_package()?;
    let filename = package.file_name()?.to_str()?;
    parse_version_from_filename(filename)
}

/// Read a file's FileVersion resource using PowerShell.
fn read_file_version(path: &Path) -> Option<String> {
    let path_str = powershell_single_quoted(&path.to_string_lossy());
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; (Get-Item '{path_str}').VersionInfo.FileVersion"
    );
    let raw = run_powershell_script(&script)?;
    if raw.is_empty() {
        return None;
    }
    parse_version_from_filename(&raw).or(Some(raw))
}

fn cc_switch_current_version() -> Option<String> {
    let exe = cc_switch_executable_path()?;
    read_file_version(&exe)
}

impl ToolInstaller for CCSwitchInstallerWin {
    fn name(&self) -> &str {
        "CC-Switch"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move {
            let installed = cc_switch_executable_path().is_some();
            let current_version = if installed {
                cc_switch_current_version()
            } else {
                None
            };
            DetectResult {
                name: self.name().to_string(),
                installed,
                current_version,
                available_version: None,
                upgradable: false,
                installable: true,
                unavailable_reason: None,
            }
        })
    }

    fn target_version(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move { cc_switch_target_version_sync() })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            let current = cc_switch_current_version();
            let target = cc_switch_target_version_sync();
            if !is_upgrade_needed(current.as_deref(), target.as_deref()) {
                return Ok(success_result(
                    self.name(),
                    current,
                    "CC-Switch already up to date",
                ));
            }

            let packages_dir = windows_packages_dir()?;
            let package = match find_package(&packages_dir, "CC-Switch*.msi") {
                Ok(path) => path,
                Err(_) => find_package(&packages_dir, "*cc-switch*.exe")?,
            };

            verify_package_hash(&package)?;
            unblock_file(&package);

            let status = if extension_is(&package, "msi") {
                run_msi_elevated(&package, &["/qn", "/norestart"]).map_err(|error| {
                    install_failed(
                        self.name(),
                        format!(
                            "failed to launch elevated msiexec for {}: {error}",
                            package.display()
                        ),
                    )
                })?
            } else {
                run_elevated(&package, &[]).map_err(|error| {
                    install_failed(
                        self.name(),
                        format!(
                            "failed to launch elevated installer {}: {error}",
                            package.display()
                        ),
                    )
                })?
            };

            ensure_success(self.name(), &package, status)?;

            Ok(success_result(
                self.name(),
                cc_switch_current_version(),
                format!("Installed CC-Switch from {}", package.display()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            // CC-Switch has no CLI `--version`; fall back to "executable exists +
            // (if target known) FileVersion >= target".
            let target = cc_switch_target_version_sync();
            for attempt in 0..5 {
                if cc_switch_executable_path().is_some() {
                    let current = cc_switch_current_version();
                    let meets = match (current.as_deref(), target.as_deref()) {
                        (_, None) => true,
                        (None, Some(_)) => false,
                        (Some(c), Some(t)) => compare_semver(c, t) != Ordering::Less,
                    };
                    if meets {
                        return true;
                    }
                }
                if attempt + 1 < 5 {
                    sleep(Duration::from_secs(3)).await;
                }
            }
            false
        })
    }
}

pub fn refresh_path_win() -> Result<(), InstallerError> {
    let machine_path = read_registry_value(
        "HKLM\\System\\CurrentControlSet\\Control\\Session Manager\\Environment",
        "Path",
    )
    .unwrap_or_default();
    let user_path = read_registry_value("HKCU\\Environment", "Path").unwrap_or_default();

    let mut merged = Vec::new();
    push_unique_path_entries(&mut merged, &machine_path);
    push_unique_path_entries(&mut merged, &user_path);
    push_known_install_paths(&mut merged);

    let merged_path = merged.join(";");
    unsafe {
        env::set_var("PATH", &merged_path);
    }

    Ok(())
}

pub fn find_package(dir: &Path, pattern: &str) -> Result<PathBuf, InstallerError> {
    // Use read_dir + Pattern::matches instead of glob() to avoid
    // glob special-character interpretation in directory paths.
    // Only the filename is matched against the pattern.
    let compiled = Pattern::new(pattern).map_err(|error| InstallerError::PackageNotFound {
        detail: format!("invalid pattern {pattern}: {error}"),
        user_message: format!("Package not found: {pattern}"),
    })?;

    let entries = std::fs::read_dir(dir).map_err(|error| InstallerError::PackageNotFound {
        detail: format!("failed to read directory {}: {error}", dir.display()),
        user_message: format!("Package not found: {pattern}"),
    })?;

    let mut matches = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if compiled.matches(name) {
            let path = entry.path();
            if path.is_file() {
                matches.push(path);
            }
        }
    }

    matches.sort_by(|a, b| {
        let ver_a = a
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(super::detect::parse_version_from_filename);
        let ver_b = b
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(super::detect::parse_version_from_filename);
        match (ver_a.as_deref(), ver_b.as_deref()) {
            (Some(va), Some(vb)) => super::detect::compare_semver(va, vb),
            _ => a.cmp(b),
        }
    });
    matches
        .pop()
        .ok_or_else(|| InstallerError::PackageNotFound {
            detail: format!("no package matched pattern {pattern} in {}", dir.display()),
            user_message: format!("Package not found: {pattern}"),
        })
}

pub fn run_elevated(exe: &Path, args: &[&str]) -> io::Result<ExitStatus> {
    let exe_arg = powershell_single_quoted(&exe.to_string_lossy());
    let argument_list = if args.is_empty() {
        String::new()
    } else {
        let joined = args
            .iter()
            .map(|arg| format!("'{}'", powershell_single_quoted(arg)))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" -ArgumentList @({joined})")
    };

    let script = format!(
        "$process = Start-Process -FilePath '{exe_arg}'{argument_list} -Verb RunAs -Wait -PassThru; exit $process.ExitCode"
    );

    // Use full path to powershell.exe to avoid PATH dependency on fresh machines.
    // -WindowStyle Hidden suppresses the PowerShell console window without affecting
    // UAC — the consent dialog is shown by consent.exe independently of the parent
    // process window, so hiding the PowerShell window is safe here.
    Command::new(resolve_powershell_path())
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-WindowStyle")
        .arg("Hidden")
        .arg("-Command")
        .arg(script)
        .status()
}

fn resolve_powershell_path() -> PathBuf {
    if let Some(system_root) = env::var_os("SystemRoot") {
        let full = PathBuf::from(system_root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if full.is_file() {
            return full;
        }
    }
    // Fallback: rely on PATH
    PathBuf::from("powershell.exe")
}

fn run_msi_elevated(package: &Path, extra_args: &[&str]) -> io::Result<ExitStatus> {
    // Remove Zone.Identifier ADS that Windows attaches to files extracted from
    // downloaded zips.  Without this, msiexec may silently refuse to run the MSI.
    unblock_file(package);

    // Wrap the MSI path in double quotes and normalise to backslashes so
    // msiexec can parse it correctly even when the path contains non-ASCII
    // characters (e.g. Chinese directory names) or spaces.
    let package_path = package.to_string_lossy().replace('/', "\\");
    let quoted_path = format!("\"{}\"", package_path);
    let mut args = vec!["/i"];
    args.push(quoted_path.as_str());
    args.extend(extra_args);

    run_elevated(Path::new("msiexec.exe"), &args)
}

/// Remove the Zone.Identifier alternate data stream that Windows attaches to
/// files downloaded from the internet (or extracted from a downloaded archive).
fn unblock_file(path: &Path) {
    let ads_path = format!("{}:Zone.Identifier", path.to_string_lossy());
    let _ = std::fs::remove_file(ads_path);
}

pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// Run a PowerShell script and return trimmed stdout, or `None` on any failure.
fn run_powershell_script(script: &str) -> Option<String> {
    let output = hidden_command(resolve_powershell_path())
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn windows_packages_dir() -> Result<PathBuf, InstallerError> {
    Ok(locate_packages_dir()?.join("windows"))
}

fn bundled_target_version(pattern: &str) -> Option<String> {
    let dir = windows_packages_dir().ok()?;
    let package = find_package(&dir, pattern).ok()?;
    let filename = package.file_name()?.to_str()?;
    parse_version_from_filename(filename)
}

/// `target=None` means "unknown target, run anyway" — never regress when we
/// can't compare.
fn is_upgrade_needed(current: Option<&str>, target: Option<&str>) -> bool {
    match (current, target) {
        (_, None) => true,
        (None, Some(_)) => true,
        (Some(c), Some(t)) => compare_semver(c, t) == Ordering::Less,
    }
}

async fn verify_meets_target(
    program: &str,
    args: &[&str],
    target: Option<&str>,
    attempts: usize,
    wait_secs: u64,
) -> bool {
    for attempt in 0..attempts {
        let _ = refresh_path_win();
        if let Some(current) = command_version(program, args) {
            let meets = match target {
                Some(target) => compare_semver(&current, target) != Ordering::Less,
                None => true,
            };
            if meets {
                return true;
            }
        }

        if attempt + 1 < attempts {
            sleep(Duration::from_secs(wait_secs)).await;
        }
    }

    false
}

fn detect_result(name: &str, version: Option<String>) -> DetectResult {
    DetectResult {
        name: name.to_string(),
        installed: version.is_some(),
        current_version: version,
        available_version: None,
        upgradable: false,
        installable: true,
        unavailable_reason: None,
    }
}

fn success_result(
    name: &str,
    version: Option<String>,
    message: impl Into<String>,
) -> InstallResult {
    InstallResult {
        name: name.to_string(),
        success: true,
        version,
        message: message.into(),
        duration_ms: 0,
    }
}

async fn wait_installer_idle(timeout_secs: u64) {
    let interval = Duration::from_secs(3);
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        let output = hidden_command("tasklist")
            .arg("/FI")
            .arg("IMAGENAME eq msiexec.exe")
            .arg("/FO")
            .arg("CSV")
            .arg("/NH")
            .output();
        let has_msiexec = output
            .map(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.contains("msiexec.exe")
            })
            .unwrap_or(false);
        if !has_msiexec {
            return;
        }
        sleep(interval).await;
    }
}

fn command_exists_via_where(program: &str) -> bool {
    hidden_command("cmd.exe")
        .arg("/c")
        .arg(format!("where {program}"))
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn command_version(program: &str, args: &[&str]) -> Option<String> {
    let output = if command_exists_via_where(program) {
        hidden_command(program).args(args).output().ok()?
    } else {
        let fallback = fallback_program_path(program)?;
        hidden_command(fallback).args(args).output().ok()?
    };
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return Some(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        None
    } else {
        Some(stderr)
    }
}

fn ensure_success(
    tool_name: &str,
    package: &Path,
    status: ExitStatus,
) -> Result<(), InstallerError> {
    if status_is_success(&status) {
        Ok(())
    } else {
        let user_message = match status.code() {
            Some(1223) | Some(1602) => format!("{tool_name} installation was cancelled"),
            Some(1619) => format!("{tool_name} package could not be opened"),
            Some(1620) => format!("{tool_name} package is invalid"),
            Some(1603) => format!("{tool_name} installer reported a fatal error"),
            _ => format!("{tool_name} installation failed"),
        };

        Err(InstallerError::InstallFailed {
            user_message,
            detail: format!(
                "installer exited with status {:?} for {}",
                status.code(),
                package.display()
            ),
        })
    }
}

fn install_failed(tool_name: &str, detail: String) -> InstallerError {
    InstallerError::InstallFailed {
        detail,
        user_message: format!("{tool_name} installation failed"),
    }
}

fn status_is_success(status: &ExitStatus) -> bool {
    status.success() || matches!(status.code(), Some(3010) | Some(1641))
}

fn cc_switch_executable_path() -> Option<PathBuf> {
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

fn extension_is(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

fn read_registry_value(key: &str, value_name: &str) -> Option<String> {
    let output = hidden_command("reg")
        .arg("query")
        .arg(key)
        .arg("/v")
        .arg(value_name)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix(&format!("{value_name}    REG_SZ    ")) {
            return Some(value.trim().to_string());
        }
        if let Some(value) = trimmed.strip_prefix(&format!("{value_name}    REG_EXPAND_SZ    ")) {
            return Some(value.trim().to_string());
        }
        if let Some(index) = trimmed.find("REG_SZ") {
            if trimmed.starts_with(value_name) {
                return Some(trimmed[index + "REG_SZ".len()..].trim().to_string());
            }
        }
        if let Some(index) = trimmed.find("REG_EXPAND_SZ") {
            if trimmed.starts_with(value_name) {
                return Some(trimmed[index + "REG_EXPAND_SZ".len()..].trim().to_string());
            }
        }
    }

    None
}

fn push_unique_path_entries(target: &mut Vec<String>, value: &str) {
    for entry in value.split(';') {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }

        let duplicate = target
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(trimmed));
        if !duplicate {
            target.push(trimmed.to_string());
        }
    }
}

fn push_known_install_paths(target: &mut Vec<String>) {
    for candidate in known_install_paths() {
        if candidate.is_dir() {
            push_unique_path_entries(target, &candidate.to_string_lossy());
        }
    }
}

fn known_install_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(program_files) = env::var_os("ProgramFiles") {
        let program_files = PathBuf::from(program_files);
        candidates.push(program_files.join("Git").join("cmd"));
        candidates.push(program_files.join("nodejs"));
    }

    if let Some(app_data) = env::var_os("APPDATA") {
        candidates.push(PathBuf::from(app_data).join("npm"));
    }

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        let local_app_data = PathBuf::from(local_app_data);
        candidates.push(local_app_data.join("Programs").join("nu").join("bin"));
    }

    candidates
}

fn powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

fn fallback_program_path(program: &str) -> Option<PathBuf> {
    match program {
        "nu" => nushell_bin_dir()
            .map(|dir| dir.join("nu.exe"))
            .filter(|path| path.is_file()),
        "git" => env::var_os("ProgramFiles").and_then(|pf| {
            let path = PathBuf::from(pf).join("Git").join("cmd").join("git.exe");
            path.is_file().then_some(path)
        }),
        "node" => env::var_os("ProgramFiles").and_then(|pf| {
            let path = PathBuf::from(pf).join("nodejs").join("node.exe");
            path.is_file().then_some(path)
        }),
        _ => None,
    }
}

fn nushell_bin_dir() -> Option<PathBuf> {
    let local_app_data = env::var_os("LOCALAPPDATA")?;
    Some(
        PathBuf::from(local_app_data)
            .join("Programs")
            .join("nu")
            .join("bin"),
    )
}

fn ensure_nushell_on_user_path() -> Result<(), InstallerError> {
    let Some(nu_bin) = nushell_bin_dir() else {
        return Ok(());
    };

    if !nu_bin.is_dir() {
        return Ok(());
    }

    ensure_user_path_contains(&nu_bin)
}

fn ensure_user_path_contains(path: &Path) -> Result<(), InstallerError> {
    let path_str = path.to_string_lossy().to_string();
    let existing = read_registry_value("HKCU\\Environment", "Path").unwrap_or_default();
    let already_present = existing
        .split(';')
        .map(str::trim)
        .any(|entry| entry.eq_ignore_ascii_case(&path_str));

    if already_present {
        return Ok(());
    }

    let updated = if existing.trim().is_empty() {
        path_str.clone()
    } else {
        format!("{existing};{path_str}")
    };

    // Use `reg add` instead of `setx` to avoid the 1024-character truncation
    // limit that setx imposes on PATH values.
    let status = hidden_command("reg")
        .arg("add")
        .arg("HKCU\\Environment")
        .arg("/v")
        .arg("Path")
        .arg("/t")
        .arg("REG_EXPAND_SZ")
        .arg("/d")
        .arg(&updated)
        .arg("/f")
        .status()
        .map_err(|error| InstallerError::ConfigFailed {
            detail: format!(
                "failed to update user PATH with {}: {error}",
                path.display()
            ),
            user_message: "Failed to update PATH".to_string(),
        })?;

    if status.success() {
        Ok(())
    } else {
        Err(InstallerError::ConfigFailed {
            detail: format!(
                "reg add returned non-zero exit status while updating PATH with {}: {status}",
                path.display()
            ),
            user_message: "Failed to update PATH".to_string(),
        })
    }
}

// ---------------------------------------------------------------------------
// Running-process detection & termination (for npm-based CLI upgrades).
// ---------------------------------------------------------------------------

use crate::types::RunningProc;

/// Signature used to identify a running instance of an npm-installed CLI.
/// `bin_names` match against the image name (must live under `%APPDATA%\npm\`
/// to count); `path_fragments` match against the full `ExecutablePath` to
/// catch node.exe grandchildren spawned by the shim.
struct PkgSignature {
    bin_names: &'static [&'static str],
    path_fragments: &'static [&'static str],
}

fn signature_for_pkg(pkg: &str) -> &'static PkgSignature {
    static EMPTY: PkgSignature = PkgSignature {
        bin_names: &[],
        path_fragments: &[],
    };
    static CLAUDE: PkgSignature = PkgSignature {
        bin_names: &["claude.exe"],
        path_fragments: &["\\npm\\node_modules\\@anthropic-ai\\claude-code\\"],
    };
    static CODEX: PkgSignature = PkgSignature {
        bin_names: &["codex.exe"],
        path_fragments: &["\\npm\\node_modules\\@openai\\codex\\"],
    };
    static GEMINI: PkgSignature = PkgSignature {
        bin_names: &["gemini.exe"],
        path_fragments: &["\\npm\\node_modules\\@google\\gemini-cli\\"],
    };
    match pkg {
        "@anthropic-ai/claude-code" => &CLAUDE,
        "@openai/codex" => &CODEX,
        "@google/gemini-cli" => &GEMINI,
        _ => &EMPTY,
    }
}

/// Enumerate running processes that hold the target npm package's files open.
///
/// Matches only on two precise signals:
/// 1. Image name equals the CLI's `.exe` AND its on-disk path is under
///    `%APPDATA%\npm\` (the npm global shim directory).
/// 2. Any process's `ExecutablePath` contains the package's `node_modules`
///    directory (catches node.exe grandchildren launched by the shim).
///
/// Command-line substring matching is **deliberately avoided** — it produced
/// false positives when unrelated tools (e.g. Claude Code MCP servers) held
/// arguments that mentioned another CLI's package name.
pub(crate) fn find_running_cli_processes(pkg: &str) -> Vec<RunningProc> {
    let sig = signature_for_pkg(pkg);
    if sig.bin_names.is_empty() && sig.path_fragments.is_empty() {
        return Vec::new();
    }

    let npm_dir = match std::env::var_os("APPDATA") {
        Some(appdata) => PathBuf::from(appdata).join("npm"),
        None => return Vec::new(),
    };
    let npm_dir_str = npm_dir.to_string_lossy().to_string();

    // Pre-filter at the WMI query level (indexed, much cheaper than scanning
    // every process through a Where-Object pipeline).  Name is cheap to index,
    // ExecutablePath uses LIKE which still narrows the result set substantially
    // before the client-side validation.
    let name_or = sig
        .bin_names
        .iter()
        .map(|n| format!("Name = '{}'", wql_escape(n)))
        .collect::<Vec<_>>()
        .join(" OR ");
    let path_like = sig
        .path_fragments
        .iter()
        .map(|f| format!("ExecutablePath LIKE '%{}%'", wql_escape(f)))
        .collect::<Vec<_>>()
        .join(" OR ");
    let wql_filter = match (name_or.is_empty(), path_like.is_empty()) {
        (false, false) => format!("({name_or}) OR ({path_like})"),
        (false, true) => name_or,
        (true, false) => path_like,
        (true, true) => return Vec::new(),
    };

    // Client-side re-validation: WMI's LIKE is case-sensitive-ish and doesn't
    // enforce the %APPDATA%\npm\ root for image-name matches.  Do a final
    // ExecutablePath check in PowerShell to reject false positives.
    let name_clauses: Vec<String> = sig
        .bin_names
        .iter()
        .map(|n| {
            format!(
                "($_.Name -eq '{}' -and $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith('{}'.ToLower()))",
                powershell_single_quoted(n),
                powershell_single_quoted(&npm_dir_str)
            )
        })
        .collect();
    let path_clauses: Vec<String> = sig
        .path_fragments
        .iter()
        .map(|f| {
            format!(
                "($_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains('{}'.ToLower()))",
                powershell_single_quoted(f)
            )
        })
        .collect();
    let mut all_clauses = name_clauses;
    all_clauses.extend(path_clauses);
    let refine = all_clauses.join(" -or ");

    // CommandLine is deliberately omitted — we don't match on it and reading
    // it from WMI is the slowest column to materialize.  ExecutablePath is
    // surfaced instead for the UI's process-list display.
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         Get-CimInstance Win32_Process -Filter \"{wql_filter}\" | \
         Where-Object {{ {refine} }} | \
         Select-Object Name, ProcessId, ExecutablePath | \
         ConvertTo-Json -Depth 2 -Compress"
    );

    let stdout = match run_powershell_script(&script) {
        Some(s) if !s.is_empty() => s,
        _ => return Vec::new(),
    };

    parse_cim_process_json(&stdout)
}

/// Escape a string for safe embedding inside a WQL single-quoted literal.
/// WQL uses `\` as the escape character; only `'` and `\` need escaping.
fn wql_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn parse_cim_process_json(stdout: &str) -> Vec<RunningProc> {
    let value: serde_json::Value = match serde_json::from_str(stdout) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let items: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(arr) => arr.iter().collect(),
        serde_json::Value::Object(_) => vec![&value],
        _ => return Vec::new(),
    };

    items
        .into_iter()
        .filter_map(|item| {
            let pid = item
                .get("ProcessId")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32)?;
            let name = item
                .get("Name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let executable_path = item
                .get("ExecutablePath")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(RunningProc {
                pid,
                name,
                executable_path,
            })
        })
        .collect()
}

/// Terminate the given PIDs with `taskkill /F /T` in a single invocation.
/// Returns the number of PIDs taskkill reported terminating; on partial
/// failure (some PIDs already gone, access denied) the exit code is non-zero
/// and we conservatively report 0 — callers use this only to decide whether
/// to proceed, not for exact bookkeeping.
pub(crate) fn kill_processes_by_pid(pids: &[u32]) -> usize {
    if pids.is_empty() {
        return 0;
    }
    let mut cmd = hidden_command("taskkill");
    cmd.arg("/F").arg("/T");
    for pid in pids {
        cmd.arg("/PID").arg(pid.to_string());
    }
    match cmd.status() {
        Ok(status) if status.success() => pids.len(),
        _ => 0,
    }
}

#[cfg(test)]
mod upgrade_decision_tests {
    use super::{is_upgrade_needed, parse_cim_process_json};

    #[test]
    fn current_newer_than_target_skips() {
        assert!(!is_upgrade_needed(Some("2.0.0"), Some("1.0.0")));
    }

    #[test]
    fn current_older_than_target_runs() {
        assert!(is_upgrade_needed(Some("1.0.0"), Some("2.0.0")));
    }

    #[test]
    fn current_equal_target_skips() {
        assert!(!is_upgrade_needed(Some("1.2.3"), Some("1.2.3")));
    }

    #[test]
    fn no_target_runs_by_default() {
        // Unknown target — we cannot compare, so install anyway (never regress behavior).
        assert!(is_upgrade_needed(Some("1.0.0"), None));
        assert!(is_upgrade_needed(None, None));
    }

    #[test]
    fn no_current_runs() {
        assert!(is_upgrade_needed(None, Some("1.0.0")));
    }

    #[test]
    fn cim_array_parses() {
        let json = r#"[
            {"Name":"codex.exe","ProcessId":12345,"ExecutablePath":"C:\\path\\codex.exe"},
            {"Name":"node.exe","ProcessId":67890,"ExecutablePath":"C:\\path\\node.exe"}
        ]"#;
        let procs = parse_cim_process_json(json);
        assert_eq!(procs.len(), 2);
        assert_eq!(procs[0].pid, 12345);
        assert_eq!(procs[0].name, "codex.exe");
        assert_eq!(
            procs[0].executable_path.as_deref(),
            Some("C:\\path\\codex.exe")
        );
        assert_eq!(procs[1].pid, 67890);
    }

    #[test]
    fn cim_single_object_parses() {
        let json = r#"{"Name":"codex.exe","ProcessId":42,"ExecutablePath":null}"#;
        let procs = parse_cim_process_json(json);
        assert_eq!(procs.len(), 1);
        assert_eq!(procs[0].pid, 42);
        assert_eq!(procs[0].name, "codex.exe");
        assert!(procs[0].executable_path.is_none());
    }

    #[test]
    fn cim_empty_or_malformed_returns_empty() {
        assert!(parse_cim_process_json("").is_empty());
        assert!(parse_cim_process_json("not json").is_empty());
        assert!(parse_cim_process_json("null").is_empty());
    }
}
