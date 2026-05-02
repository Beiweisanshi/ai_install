#![cfg(target_os = "macos")]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};
use std::time::{SystemTime, UNIX_EPOCH};

use glob::Pattern;
use tauri::AppHandle;

use super::{BoxFuture, ToolInstaller, locate_packages_dir, verify_package_hash};
use crate::types::{DetectResult, InstallResult, InstallerError};

pub struct NushellInstallerMac;

impl ToolInstaller for NushellInstallerMac {
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

            match install_nushell_from_archive() {
                Ok(()) => Ok(success_result(
                    self.name(),
                    command_version("nu", &["--version"]),
                    "Installed Nushell from local archive",
                )),
                Err(error) if should_fallback_to_brew(&error) => {
                    brew_install(&["install", "nushell"])?;
                    Ok(success_result(
                        self.name(),
                        command_version("nu", &["--version"]),
                        "Installed Nushell with Homebrew",
                    ))
                }
                Err(error) => Err(error),
            }
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { command_version("nu", &["--version"]).is_some() })
    }
}

pub struct GitInstallerMac;

impl ToolInstaller for GitInstallerMac {
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

            brew_install(&["install", "git"])?;

            Ok(success_result(
                self.name(),
                command_version("git", &["--version"]),
                "Installed Git with Homebrew",
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { command_version("git", &["--version"]).is_some() })
    }
}

pub struct NodeInstallerMac;

impl ToolInstaller for NodeInstallerMac {
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

            match install_node_from_pkg() {
                Ok(()) => Ok(success_result(
                    self.name(),
                    command_version("node", &["--version"]),
                    "Installed Node.js from local package",
                )),
                Err(error) if should_fallback_to_brew(&error) => {
                    brew_install(&["install", "node"])?;
                    Ok(success_result(
                        self.name(),
                        command_version("node", &["--version"]),
                        "Installed Node.js with Homebrew",
                    ))
                }
                Err(error) => Err(error),
            }
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { command_version("node", &["--version"]).is_some() })
    }
}

pub struct CCSwitchInstallerMac;

impl ToolInstaller for CCSwitchInstallerMac {
    fn name(&self) -> &str {
        "CC-Switch"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move {
            let installed = cc_switch_app_path().is_some()
                || command_version("cc-switch", &["--version"]).is_some();
            DetectResult {
                name: self.name().to_string(),
                installed,
                current_version: command_version("cc-switch", &["--version"]),
                available_version: None,
                upgradable: false,
                installable: true,
                unavailable_reason: None,
                required: false,
                group: "tool".to_string(),
            }
        })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            if cc_switch_app_path().is_some() {
                return Ok(success_result(
                    self.name(),
                    command_version("cc-switch", &["--version"]),
                    "CC-Switch already installed",
                ));
            }

            match install_cc_switch_from_local() {
                Ok(()) => Ok(success_result(
                    self.name(),
                    command_version("cc-switch", &["--version"]),
                    "Installed CC-Switch from local package",
                )),
                Err(error) if should_fallback_to_brew(&error) => {
                    brew_install(&["install", "--cask", "cc-switch"])?;
                    Ok(success_result(
                        self.name(),
                        command_version("cc-switch", &["--version"]),
                        "Installed CC-Switch with Homebrew",
                    ))
                }
                Err(error) => Err(error),
            }
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { cc_switch_app_path().is_some() })
    }
}

pub fn run_with_admin(cmd: &str) -> Result<ExitStatus, InstallerError> {
    validate_admin_command(cmd)?;

    let script = format!("do shell script \"{cmd}\" with administrator privileges");
    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|error| InstallerError::InstallFailed {
            detail: format!("failed to execute osascript command: {error}"),
            user_message: "Administrator command failed".to_string(),
        })
}

fn install_nushell_from_archive() -> Result<(), InstallerError> {
    let packages_dir = macos_packages_dir()?;
    let archive = find_package_from_patterns(&packages_dir, &["nushell-*.tar.gz", "nu-*.tar.gz"])?;
    verify_package_hash(&archive)?;

    let temp_dir = create_temp_dir("nushell")?;
    let extract_result = Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&temp_dir)
        .status()
        .map_err(|error| {
            install_failed(
                "Nushell",
                format!("failed to extract {}: {error}", archive.display()),
            )
        });

    let status = extract_result?;
    ensure_success("Nushell", &archive, status)?;

    let binary = find_named_file(&temp_dir, "nu").ok_or_else(|| InstallerError::InstallFailed {
        detail: format!("nu binary not found after extracting {}", archive.display()),
        user_message: "Nushell installation failed".to_string(),
    })?;

    let install_cmd = format!(
        "/usr/bin/install -m 755 {} /usr/local/bin/nu",
        shell_escape_path(&binary)?
    );
    let status = run_with_admin(&install_cmd)?;
    ensure_success("Nushell", &archive, status)
}

fn install_node_from_pkg() -> Result<(), InstallerError> {
    let packages_dir = macos_packages_dir()?;
    let package = find_package(&packages_dir, "node-*.pkg")?;
    verify_package_hash(&package)?;

    let command = format!(
        "/usr/sbin/installer -pkg {} -target /",
        shell_escape_path(&package)?
    );
    let status = run_with_admin(&command)?;
    ensure_success("Node.js", &package, status)
}

fn install_cc_switch_from_local() -> Result<(), InstallerError> {
    let packages_dir = macos_packages_dir()?;

    if let Ok(archive) =
        find_package_from_patterns(&packages_dir, &["CC-Switch*.tar.gz", "*cc-switch*.tar.gz"])
    {
        verify_package_hash(&archive)?;
        let temp_dir = create_temp_dir("cc-switch")?;
        let status = Command::new("tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&temp_dir)
            .status()
            .map_err(|error| {
                install_failed(
                    "CC-Switch",
                    format!("failed to extract {}: {error}", archive.display()),
                )
            })?;

        ensure_success("CC-Switch", &archive, status)?;

        let app = find_app_bundle(&temp_dir).ok_or_else(|| InstallerError::InstallFailed {
            detail: format!(
                "cc-switch app not found after extracting {}",
                archive.display()
            ),
            user_message: "CC-Switch installation failed".to_string(),
        })?;

        let destination = PathBuf::from("/Applications").join(
            app.file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| InstallerError::InvalidInput {
                    detail: format!("invalid app bundle name: {}", app.display()),
                    user_message: "CC-Switch installation failed".to_string(),
                })?,
        );

        let command = format!(
            "/usr/bin/ditto {} {}",
            shell_escape_path(&app)?,
            shell_escape_path(&destination)?
        );
        let status = run_with_admin(&command)?;
        return ensure_success("CC-Switch", &archive, status);
    }

    let dmg = find_package_from_patterns(&packages_dir, &["CC-Switch*.dmg", "*cc-switch*.dmg"])?;
    verify_package_hash(&dmg)?;

    let attach_output = Command::new("hdiutil")
        .arg("attach")
        .arg(&dmg)
        .arg("-nobrowse")
        .output()
        .map_err(|error| {
            install_failed(
                "CC-Switch",
                format!("failed to mount {}: {error}", dmg.display()),
            )
        })?;

    if !attach_output.status.success() {
        return Err(install_failed(
            "CC-Switch",
            format!("failed to mount disk image {}", dmg.display()),
        ));
    }

    let mount_point =
        parse_mount_point(&attach_output.stdout).ok_or_else(|| InstallerError::InstallFailed {
            detail: format!("failed to parse mount point for {}", dmg.display()),
            user_message: "CC-Switch installation failed".to_string(),
        })?;

    let app = find_app_bundle(&mount_point).ok_or_else(|| InstallerError::InstallFailed {
        detail: format!("cc-switch app not found in mounted image {}", dmg.display()),
        user_message: "CC-Switch installation failed".to_string(),
    })?;

    let destination = PathBuf::from("/Applications").join(
        app.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| InstallerError::InvalidInput {
                detail: format!("invalid app bundle name: {}", app.display()),
                user_message: "CC-Switch installation failed".to_string(),
            })?,
    );

    let copy_command = format!(
        "/usr/bin/ditto {} {}",
        shell_escape_path(&app)?,
        shell_escape_path(&destination)?
    );
    let copy_status = run_with_admin(&copy_command)?;

    let detach_status = Command::new("hdiutil")
        .arg("detach")
        .arg(&mount_point)
        .status()
        .map_err(|error| {
            install_failed(
                "CC-Switch",
                format!("failed to unmount {}: {error}", mount_point.display()),
            )
        })?;

    ensure_success("CC-Switch", &dmg, copy_status)?;
    ensure_success("CC-Switch", &mount_point, detach_status)
}

fn macos_packages_dir() -> Result<PathBuf, InstallerError> {
    Ok(locate_packages_dir()?.join("macos"))
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
        required: matches!(name, "Git" | "Node.js"),
        group: if matches!(name, "Git") {
            "vcs"
        } else {
            "runtime"
        }
        .to_string(),
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

fn command_version(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
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

fn brew_install(args: &[&str]) -> Result<(), InstallerError> {
    let status = Command::new("brew").args(args).status().map_err(|error| {
        install_failed(
            "Homebrew",
            format!("failed to run brew {}: {error}", args.join(" ")),
        )
    })?;

    if status.success() {
        Ok(())
    } else {
        Err(InstallerError::InstallFailed {
            detail: format!(
                "brew exited with status {:?} for arguments {}",
                status.code(),
                args.join(" ")
            ),
            user_message: "Homebrew installation failed".to_string(),
        })
    }
}

fn ensure_success(
    tool_name: &str,
    source: &Path,
    status: ExitStatus,
) -> Result<(), InstallerError> {
    if status.success() {
        Ok(())
    } else {
        Err(install_failed(
            tool_name,
            format!(
                "installer exited with status {:?} for {}",
                status.code(),
                source.display()
            ),
        ))
    }
}

fn install_failed(tool_name: &str, detail: String) -> InstallerError {
    InstallerError::InstallFailed {
        detail,
        user_message: format!("{tool_name} installation failed"),
    }
}

fn should_fallback_to_brew(error: &InstallerError) -> bool {
    matches!(
        error,
        InstallerError::PackageNotFound { .. } | InstallerError::InstallFailed { .. }
    )
}

fn find_package(dir: &Path, pattern: &str) -> Result<PathBuf, InstallerError> {
    find_package_from_patterns(dir, &[pattern])
}

fn find_package_from_patterns(dir: &Path, patterns: &[&str]) -> Result<PathBuf, InstallerError> {
    let mut last_error = None;

    for pattern in patterns {
        match find_glob_match(dir, pattern) {
            Ok(path) => return Ok(path),
            Err(error) => last_error = Some(error),
        }
    }

    last_error.unwrap_or_else(|| InstallerError::PackageNotFound {
        detail: format!("no package matched in {}", dir.display()),
        user_message: "Package not found".to_string(),
    })
}

fn find_glob_match(dir: &Path, pattern: &str) -> Result<PathBuf, InstallerError> {
    let compiled = Pattern::new(pattern).map_err(|error| InstallerError::PackageNotFound {
        detail: format!("invalid pattern {pattern}: {error}"),
        user_message: format!("Package not found: {pattern}"),
    })?;

    let entries = std::fs::read_dir(dir).map_err(|error| InstallerError::PackageNotFound {
        detail: format!("failed to read directory {}: {error}", dir.display()),
        user_message: format!("Package not found: {pattern}"),
    })?;

    let mut matches = Vec::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if compiled.matches(name) && entry.path().exists() {
            matches.push(entry.path());
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

fn cc_switch_app_path() -> Option<PathBuf> {
    let compiled = Pattern::new("*[Cc][Cc]*[Ss]witch*.app").ok()?;
    let entries = std::fs::read_dir("/Applications").ok()?;
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if compiled.matches(name) {
            let path = entry.path();
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

fn create_temp_dir(prefix: &str) -> Result<PathBuf, InstallerError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = std::env::temp_dir().join(format!("gui-installer-{prefix}-{millis}"));

    fs::create_dir_all(&path).map_err(|error| InstallerError::InstallFailed {
        detail: format!(
            "failed to create temp directory {}: {error}",
            path.display()
        ),
        user_message: "Failed to prepare installer workspace".to_string(),
    })?;

    Ok(path)
}

fn find_named_file(dir: &Path, target_name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries {
        let path = entry.ok()?.path();
        if path.is_dir() {
            if let Some(found) = find_named_file(&path, target_name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|name| name.to_str()) == Some(target_name) {
            return Some(path);
        }
    }
    None
}

fn find_app_bundle(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries {
        let path = entry.ok()?.path();
        if path.extension().and_then(|value| value.to_str()) == Some("app") {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_app_bundle(&path) {
                return Some(found);
            }
        }
    }
    None
}

fn parse_mount_point(output: &[u8]) -> Option<PathBuf> {
    let text = String::from_utf8_lossy(output);
    for line in text.lines() {
        if let Some(index) = line.find("/Volumes/") {
            return Some(PathBuf::from(line[index..].trim()));
        }
    }
    None
}

fn validate_admin_command(cmd: &str) -> Result<(), InstallerError> {
    if cmd.is_empty() {
        return Err(InstallerError::InvalidInput {
            detail: "administrator command is empty".to_string(),
            user_message: "Administrator command failed".to_string(),
        });
    }

    if cmd.contains('\'')
        || cmd.contains('"')
        || cmd.contains(';')
        || cmd.contains('|')
        || cmd.contains('&')
        || cmd.contains('$')
        || cmd.contains('\n')
        || cmd.contains('\r')
    {
        return Err(InstallerError::InvalidInput {
            detail: format!("administrator command contains forbidden characters: {cmd}"),
            user_message: "Administrator command failed".to_string(),
        });
    }

    Ok(())
}

fn shell_escape_path(path: &Path) -> Result<String, InstallerError> {
    let raw = path.to_str().ok_or_else(|| InstallerError::InvalidInput {
        detail: format!("path is not valid UTF-8: {}", path.display()),
        user_message: "Invalid installer path".to_string(),
    })?;

    let mut escaped = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '\'' | '"' | ';' | '|' | '&' | '$' | '\n' | '\r' => {
                return Err(InstallerError::InvalidInput {
                    detail: format!("path contains forbidden shell character {ch}: {raw}"),
                    user_message: "Invalid installer path".to_string(),
                });
            }
            ' ' | '(' | ')' | '[' | ']' | '{' | '}' | '!' | '?' | '*' | '#' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            _ => escaped.push(ch),
        }
    }

    Ok(escaped)
}
