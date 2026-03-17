#![cfg(target_os = "windows")]

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

use super::{BoxFuture, ToolInstaller, locate_packages_dir, verify_package_hash};
use crate::types::{DetectResult, InstallResult, InstallerError};

pub const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct NushellInstallerWin;

impl ToolInstaller for NushellInstallerWin {
    fn name(&self) -> &str {
        "Nushell"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name(), command_version("nu", &["--version"])) })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            if let Some(version) = command_version("nu", &["--version"]) {
                return Ok(success_result(
                    self.name(),
                    Some(version),
                    "Nushell already installed",
                ));
            }

            let package = find_package(&windows_packages_dir()?, "nushell-*.msi")?;
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
        Box::pin(async move { verify_command_with_retries("nu", &["--version"], 5, 3).await })
    }
}

pub struct GitInstallerWin;

impl ToolInstaller for GitInstallerWin {
    fn name(&self) -> &str {
        "Git"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name(), command_version("git", &["--version"])) })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            if let Some(version) = command_version("git", &["--version"]) {
                return Ok(success_result(
                    self.name(),
                    Some(version),
                    "Git already installed",
                ));
            }

            let package = find_package(&windows_packages_dir()?, "Git-*-64-bit.exe")?;
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

            Ok(success_result(
                self.name(),
                command_version("git", &["--version"]),
                format!("Installed Git from {}", package.display()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            let _ = refresh_path_win();
            command_version("git", &["--version"]).is_some()
        })
    }
}

pub struct NodeInstallerWin;

impl ToolInstaller for NodeInstallerWin {
    fn name(&self) -> &str {
        "Node.js"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name(), command_version("node", &["--version"])) })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            if let Some(version) = command_version("node", &["--version"]) {
                return Ok(success_result(
                    self.name(),
                    Some(version),
                    "Node.js already installed",
                ));
            }

            let package = find_package(&windows_packages_dir()?, "node-*-x64.msi")?;
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
            for attempt in 0..3 {
                let _ = refresh_path_win();
                if command_version("node", &["--version"]).is_some() {
                    return true;
                }

                if attempt < 2 {
                    sleep(Duration::from_secs(5)).await;
                }
            }

            false
        })
    }
}

pub struct CCSwitchInstallerWin;

impl ToolInstaller for CCSwitchInstallerWin {
    fn name(&self) -> &str {
        "CC-Switch"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move {
            let installed = cc_switch_executable_path().is_some();
            DetectResult {
                name: self.name().to_string(),
                installed,
                current_version: None,
                available_version: None,
                upgradable: false,
                installable: true,
                unavailable_reason: None,
            }
        })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            if cc_switch_executable_path().is_some() {
                return Ok(success_result(
                    self.name(),
                    None,
                    "CC-Switch already installed",
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
                None,
                format!("Installed CC-Switch from {}", package.display()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { cc_switch_executable_path().is_some() })
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
        let ver_a = a.file_name().and_then(|n| n.to_str()).and_then(super::detect::parse_version_from_filename);
        let ver_b = b.file_name().and_then(|n| n.to_str()).and_then(super::detect::parse_version_from_filename);
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
    // Do NOT use hidden_command / CREATE_NO_WINDOW here — -Verb RunAs needs a
    // visible process so the OS can show the UAC consent dialog.
    Command::new(resolve_powershell_path())
        .arg("-NoProfile")
        .arg("-NonInteractive")
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

fn windows_packages_dir() -> Result<PathBuf, InstallerError> {
    Ok(locate_packages_dir()?.join("windows"))
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

async fn verify_command_with_retries(
    program: &str,
    args: &[&str],
    wait_secs: u64,
    attempts: usize,
) -> bool {
    for attempt in 0..attempts {
        let _ = refresh_path_win();
        if command_version(program, args).is_some() {
            return true;
        }

        if attempt + 1 < attempts {
            sleep(Duration::from_secs(wait_secs)).await;
        }
    }

    false
}
