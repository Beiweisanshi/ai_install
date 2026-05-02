pub mod detect;
pub mod macos;
pub mod npm;
pub mod windows;

use std::cmp::Ordering;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::time::SystemTime;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

use crate::types::{DetectResult, InstallResult, InstallerError, ProgressEvent};

const INSTALL_TIMEOUT_SECS: u64 = 300;

type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait ToolInstaller: Send + Sync {
    fn name(&self) -> &str;
    fn detect(&self) -> BoxFuture<'_, DetectResult>;
    fn install(&self, app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>>;
    fn verify(&self) -> BoxFuture<'_, bool>;
    fn dependencies(&self) -> &'static [&'static str] {
        &[]
    }

    /// The version the pipeline expects to see on disk after `install()`.
    /// Returning `None` means "unknown target" — the pipeline will still run
    /// but cannot enforce the upgrade invariant.
    fn target_version(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async { None })
    }
}

pub fn emit_progress(app: &AppHandle, tool_name: &str, stage: &str, percent: u8, message: &str) {
    let event = ProgressEvent {
        tool_name: tool_name.to_string(),
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    };

    let _ = app.emit("install-progress", event);
}

pub async fn install_tool_pipeline(
    installer: &dyn ToolInstaller,
    app: &AppHandle,
) -> InstallResult {
    let started_at = Instant::now();
    let tool_name = installer.name().to_string();

    emit_progress(
        app,
        &tool_name,
        "detecting",
        0,
        "Checking existing installation",
    );
    let detect_result = installer.detect().await;

    let detect_message = if detect_result.installed {
        match detect_result.current_version.as_deref() {
            Some(version) => format!("Detected installed version {version}"),
            None => "Detected installed version".to_string(),
        }
    } else {
        "No installed version detected; starting install".to_string()
    };
    emit_progress(app, &tool_name, "detecting", 10, &detect_message);

    emit_progress(app, &tool_name, "installing", 20, "Preparing installation");
    let install_outcome = run_with_timeout(installer.install(app), INSTALL_TIMEOUT_SECS).await;

    let install_result = match install_outcome {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            let elapsed = elapsed_ms(started_at);
            let message = format_error_message(&error);
            emit_progress(app, &tool_name, "failed", 100, &message);
            return failed_result(&tool_name, &message, elapsed);
        }
        Err(error) => {
            let elapsed = elapsed_ms(started_at);
            let message = format_error_message(&error);
            emit_progress(app, &tool_name, "failed", 100, &message);
            return failed_result(&tool_name, &message, elapsed);
        }
    };

    if !install_result.success {
        let elapsed = elapsed_ms(started_at);
        emit_progress(app, &tool_name, "failed", 100, &install_result.message);
        return InstallResult {
            duration_ms: elapsed,
            ..install_result
        };
    }

    emit_progress(
        app,
        &tool_name,
        "installing",
        70,
        "Installation finished, preparing verification",
    );
    emit_progress(app, &tool_name, "verifying", 80, "Verifying installation");
    let verify_ok = installer.verify().await;
    let post_install = installer.detect().await;
    let post_version = post_install.current_version.clone();
    let target_version = installer.target_version().await;

    let elapsed = elapsed_ms(started_at);
    let fail = |message: String, version: Option<String>| {
        emit_progress(app, &tool_name, "failed", 100, &message);
        InstallResult {
            name: tool_name.clone(),
            success: false,
            version,
            message,
            duration_ms: elapsed,
        }
    };

    match evaluate_version_check(
        verify_ok,
        post_version.as_deref(),
        target_version.as_deref(),
    ) {
        VersionCheckOutcome::VerifyFailed => {
            fail("Post-install verification failed".to_string(), post_version)
        }
        VersionCheckOutcome::NoVersion => fail(
            "Post-install version probe returned nothing".to_string(),
            None,
        ),
        VersionCheckOutcome::BelowTarget { post, target } => fail(
            format!("Installed {post} is older than expected {target}; upgrade did not apply"),
            Some(post),
        ),
        VersionCheckOutcome::Ok => {
            let message = if install_result.message.is_empty() {
                "Installation complete".to_string()
            } else {
                install_result.message.clone()
            };
            emit_progress(app, &tool_name, "done", 100, &message);
            InstallResult {
                name: tool_name,
                success: true,
                version: post_version,
                message,
                duration_ms: elapsed,
            }
        }
    }
}

pub async fn run_with_timeout<F>(future: F, secs: u64) -> Result<F::Output, InstallerError>
where
    F: Future,
{
    timeout(Duration::from_secs(secs), future)
        .await
        .map_err(|_| InstallerError::Timeout {
            detail: format!("operation timed out after {secs} seconds"),
            user_message: format!("Operation timed out after {secs} seconds"),
        })
}

pub fn locate_packages_dir() -> Result<PathBuf, InstallerError> {
    let current_exe = std::env::current_exe().map_err(|error| InstallerError::PackageNotFound {
        detail: format!("failed to resolve current executable path: {error}"),
        user_message: "Failed to locate installer executable".to_string(),
    })?;

    // On Windows, current_exe() may return an extended-length path (\\?\C:\...)
    // which breaks path operations and directory listing.  Strip the prefix.
    let current_exe = strip_extended_length_prefix(&current_exe);

    locate_packages_dir_from_exe(&current_exe)
}

fn strip_extended_length_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

fn locate_packages_dir_from_exe(current_exe: &Path) -> Result<PathBuf, InstallerError> {
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| InstallerError::PackageNotFound {
            detail: format!(
                "executable has no parent directory: {}",
                current_exe.display()
            ),
            user_message: "Failed to locate installer directory".to_string(),
        })?;

    let mut candidates = Vec::new();
    if let Some(app_bundle_dir) = macos_app_bundle_dir(current_exe) {
        if let Some(app_parent_dir) = app_bundle_dir.parent() {
            candidates.push(app_parent_dir.join("packages"));
        }
        candidates.push(
            app_bundle_dir
                .join("Contents")
                .join("Resources")
                .join("packages"),
        );
    }
    if let Some(parent_dir) = exe_dir.parent() {
        candidates.push(parent_dir.join("packages"));
    }
    candidates.push(exe_dir.join("packages"));

    for candidate in candidates {
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }

    Err(InstallerError::PackageNotFound {
        detail: format!(
            "packages directory not found near executable: {}",
            exe_dir.display()
        ),
        user_message: "Packages directory not found".to_string(),
    })
}

fn macos_app_bundle_dir(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|ancestor| ancestor.extension().and_then(|value| value.to_str()) == Some("app"))
        .map(Path::to_path_buf)
}

pub fn verify_package_hash(path: &Path) -> Result<(), InstallerError> {
    let packages_dir = locate_packages_dir()?;
    verify_package_hash_in_packages_dir(path, &packages_dir)
}

fn verify_package_hash_in_packages_dir(
    path: &Path,
    packages_dir: &Path,
) -> Result<(), InstallerError> {
    let checksums_path = match packages_dir.parent() {
        Some(parent) => parent.join("checksums.json"),
        None => {
            return Ok(());
        }
    };

    if !checksums_path.is_file() {
        return Ok(());
    }

    let file_name = match path.file_name().and_then(|name| name.to_str()) {
        Some(file_name) => file_name,
        None => {
            return Err(InstallerError::InvalidInput {
                detail: format!("invalid package file name: {}", path.display()),
                user_message: "Invalid package file name".to_string(),
            });
        }
    };

    let checksum_content =
        fs::read_to_string(&checksums_path).map_err(|error| InstallerError::InvalidInput {
            detail: format!(
                "failed to read checksum file {}: {error}",
                checksums_path.display()
            ),
            user_message: "Failed to read checksums.json".to_string(),
        })?;

    let checksums: serde_json::Value =
        serde_json::from_str(&checksum_content).map_err(|error| InstallerError::InvalidInput {
            detail: format!(
                "failed to parse checksum file {}: {error}",
                checksums_path.display()
            ),
            user_message: "Invalid checksums.json format".to_string(),
        })?;

    let expected_hash = checksums.get(file_name).and_then(|value| {
        value.as_str().map(str::to_owned).or_else(|| {
            value
                .get("sha256")
                .and_then(|item| item.as_str())
                .map(str::to_owned)
        })
    });

    let Some(expected_hash) = expected_hash else {
        return Ok(());
    };

    let package_bytes = fs::read(path).map_err(|error| InstallerError::InvalidInput {
        detail: format!("failed to read package {}: {error}", path.display()),
        user_message: "Failed to read package file".to_string(),
    })?;

    let actual_hash = format!("{:x}", Sha256::digest(package_bytes));
    if actual_hash.eq_ignore_ascii_case(expected_hash.trim()) {
        Ok(())
    } else {
        Err(InstallerError::HashMismatch {
            detail: format!(
                "package hash mismatch for {}: expected {}, got {}",
                path.display(),
                expected_hash,
                actual_hash
            ),
            user_message: format!("Package hash mismatch: {file_name}"),
        })
    }
}

pub async fn dispatch_installers(
    installers: Vec<Box<dyn ToolInstaller>>,
    app: &AppHandle,
) -> Vec<InstallResult> {
    let mut results = Vec::with_capacity(installers.len());
    let mut completed: Vec<InstallResult> = Vec::with_capacity(installers.len());

    for installer in installers {
        if let Some(blocked_by) = blocked_dependency(installer.as_ref(), &completed) {
            let message = format!(
                "Skipped because dependency {} failed earlier: {}",
                blocked_by.name, blocked_by.message
            );
            emit_progress(app, installer.name(), "failed", 100, &message);

            let result = InstallResult {
                name: installer.name().to_string(),
                success: false,
                version: None,
                message,
                duration_ms: 0,
            };

            completed.push(result.clone());
            results.push(result);
            continue;
        }

        let result = install_tool_pipeline(installer.as_ref(), app).await;
        completed.push(result.clone());
        results.push(result);
    }

    results
}

pub fn write_install_report(
    requested_tools: &[String],
    results: &[InstallResult],
) -> Option<PathBuf> {
    #[derive(Serialize)]
    struct InstallReport<'a> {
        generated_at_unix_ms: u128,
        requested_tools: &'a [String],
        executable_path: Option<String>,
        packages_dir: Option<String>,
        results: &'a [InstallResult],
    }

    let report_dir = install_report_dir()?;
    fs::create_dir_all(&report_dir).ok()?;

    let generated_at_unix_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_millis();
    let report_path = report_dir.join(format!("install-report-{generated_at_unix_ms}.json"));

    let report = InstallReport {
        generated_at_unix_ms,
        requested_tools,
        executable_path: std::env::current_exe()
            .ok()
            .map(|path| path.display().to_string()),
        packages_dir: locate_packages_dir()
            .ok()
            .map(|path| path.display().to_string()),
        results,
    };

    let payload = json!(report);
    let serialized = serde_json::to_vec_pretty(&payload).ok()?;
    fs::write(&report_path, serialized).ok()?;
    Some(report_path)
}

fn elapsed_ms(started_at: Instant) -> u64 {
    let millis = started_at.elapsed().as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

fn failed_result(name: &str, message: &str, duration_ms: u64) -> InstallResult {
    InstallResult {
        name: name.to_string(),
        success: false,
        version: None,
        message: message.to_string(),
        duration_ms,
    }
}

fn format_error_message(error: &InstallerError) -> String {
    let detail = error.detail().trim();
    if detail.is_empty() || detail == error.user_message() {
        error.user_message().to_string()
    } else {
        format!("{} ({detail})", error.user_message())
    }
}

fn blocked_dependency<'a>(
    installer: &dyn ToolInstaller,
    completed: &'a [InstallResult],
) -> Option<&'a InstallResult> {
    installer.dependencies().iter().find_map(|dependency| {
        completed
            .iter()
            .find(|result| result.name == *dependency && !result.success)
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum VersionCheckOutcome {
    Ok,
    VerifyFailed,
    /// `verify()` passed and a target version exists, but no version could be probed.
    NoVersion,
    BelowTarget {
        post: String,
        target: String,
    },
}

pub fn evaluate_version_check(
    verify_ok: bool,
    post_version: Option<&str>,
    target_version: Option<&str>,
) -> VersionCheckOutcome {
    if !verify_ok {
        return VersionCheckOutcome::VerifyFailed;
    }
    if let Some(target) = target_version {
        let Some(post) = post_version else {
            return VersionCheckOutcome::NoVersion;
        };
        if detect::compare_semver(post, target) == Ordering::Less {
            return VersionCheckOutcome::BelowTarget {
                post: post.to_string(),
                target: target.to_string(),
            };
        }
    }
    VersionCheckOutcome::Ok
}

fn install_report_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var_os("LOCALAPPDATA")?;
        return Some(
            PathBuf::from(local_app_data)
                .join("gui-installer")
                .join("logs"),
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        Some(std::env::temp_dir().join("gui-installer").join("logs"))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use tauri::AppHandle;

    use crate::types::{DetectResult, InstallResult, InstallerError};

    use super::{
        BoxFuture, ToolInstaller, VersionCheckOutcome, blocked_dependency, evaluate_version_check,
        format_error_message, locate_packages_dir_from_exe, verify_package_hash_in_packages_dir,
    };

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
            "gui-installer-tests-{}-{nanos}",
            std::process::id()
        ))
    }

    fn create_fake_exe_layout(root: &Path) -> (PathBuf, PathBuf) {
        let exe_dir = root.join("bin");
        let packages_dir = root.join("packages");
        fs::create_dir_all(&exe_dir).expect("create exe dir");
        fs::create_dir_all(&packages_dir).expect("create packages dir");
        let exe_path = exe_dir.join("gui-installer.exe");
        fs::write(&exe_path, b"test").expect("create fake exe");
        (exe_path, packages_dir)
    }

    #[test]
    fn test_locate_packages_dir() {
        let _guard = test_lock().lock().expect("lock tests");
        let root = unique_temp_dir();
        let (exe_path, packages_dir) = create_fake_exe_layout(&root);

        let located = locate_packages_dir_from_exe(&exe_path).expect("locate packages dir");
        assert_eq!(located, packages_dir);

        fs::remove_dir_all(&root).expect("cleanup temp dir");
    }

    #[test]
    fn test_locate_packages_dir_next_to_macos_app_bundle() {
        let _guard = test_lock().lock().expect("lock tests");
        let root = unique_temp_dir();
        let app_macos_dir = root.join("zm_tools.app").join("Contents").join("MacOS");
        let packages_dir = root.join("packages");
        fs::create_dir_all(&app_macos_dir).expect("create app macos dir");
        fs::create_dir_all(&packages_dir).expect("create packages dir");
        let exe_path = app_macos_dir.join("gui-installer");
        fs::write(&exe_path, b"test").expect("create fake app executable");

        let located = locate_packages_dir_from_exe(&exe_path).expect("locate packages dir");
        assert_eq!(located, packages_dir);

        fs::remove_dir_all(&root).expect("cleanup temp dir");
    }

    #[test]
    fn test_verify_package_hash_missing_checksums() {
        let _guard = test_lock().lock().expect("lock tests");
        let root = unique_temp_dir();
        let (_exe_path, packages_dir) = create_fake_exe_layout(&root);
        let package_path = packages_dir.join("node-v24.14.0-x64.msi");

        let result = verify_package_hash_in_packages_dir(&package_path, &packages_dir);
        assert!(
            result.is_ok(),
            "missing checksums.json should be forward compatible"
        );

        fs::remove_dir_all(&root).expect("cleanup temp dir");
    }

    #[test]
    fn test_format_error_message_includes_detail() {
        let error = InstallerError::InstallFailed {
            detail: "npm install exited with status Some(1)".to_string(),
            user_message: "Codex CLI installation failed".to_string(),
        };

        assert_eq!(
            format_error_message(&error),
            "Codex CLI installation failed (npm install exited with status Some(1))"
        );
    }

    #[test]
    fn test_blocked_dependency_returns_failed_dependency() {
        struct DummyInstaller;

        impl ToolInstaller for DummyInstaller {
            fn name(&self) -> &str {
                "Codex CLI"
            }

            fn detect(&self) -> BoxFuture<'_, DetectResult> {
                Box::pin(async move {
                    DetectResult {
                        name: self.name().to_string(),
                        installed: false,
                        current_version: None,
                        available_version: None,
                        upgradable: false,
                        installable: true,
                        unavailable_reason: None,
                        required: false,
                        group: "test".to_string(),
                    }
                })
            }

            fn install(
                &self,
                _app: &AppHandle,
            ) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
                Box::pin(async move {
                    Ok(InstallResult {
                        name: self.name().to_string(),
                        success: true,
                        version: None,
                        message: "ok".to_string(),
                        duration_ms: 0,
                    })
                })
            }

            fn verify(&self) -> BoxFuture<'_, bool> {
                Box::pin(async move { true })
            }

            fn dependencies(&self) -> &'static [&'static str] {
                &["Node.js"]
            }
        }

        let completed = vec![InstallResult {
            name: "Node.js".to_string(),
            success: false,
            version: None,
            message: "Node.js installation failed".to_string(),
            duration_ms: 0,
        }];

        let blocked = blocked_dependency(&DummyInstaller, &completed).expect("dependency blocked");
        assert_eq!(blocked.name, "Node.js");
    }

    #[test]
    fn evaluate_version_check_ok_when_equal() {
        assert_eq!(
            evaluate_version_check(true, Some("1.2.3"), Some("1.2.3")),
            VersionCheckOutcome::Ok
        );
    }

    #[test]
    fn evaluate_version_check_ok_when_newer() {
        assert_eq!(
            evaluate_version_check(true, Some("2.0.0"), Some("1.2.3")),
            VersionCheckOutcome::Ok
        );
    }

    #[test]
    fn evaluate_version_check_ok_when_no_target() {
        // No target means we can't enforce — any detected version passes.
        assert_eq!(
            evaluate_version_check(true, Some("0.0.1"), None),
            VersionCheckOutcome::Ok
        );
    }

    #[test]
    fn evaluate_version_check_below_target_is_reported() {
        let outcome = evaluate_version_check(true, Some("1.0.0"), Some("2.0.0"));
        match outcome {
            VersionCheckOutcome::BelowTarget { post, target } => {
                assert_eq!(post, "1.0.0");
                assert_eq!(target, "2.0.0");
            }
            other => panic!("expected BelowTarget, got {other:?}"),
        }
    }

    #[test]
    fn evaluate_version_check_verify_failed_wins() {
        // If verify fails, we don't claim success even if the version matches.
        assert_eq!(
            evaluate_version_check(false, Some("1.2.3"), Some("1.2.3")),
            VersionCheckOutcome::VerifyFailed
        );
    }

    #[test]
    fn evaluate_version_check_missing_version_with_target_fails() {
        // verify() returned true but command_version() produced nothing —
        // with a target version, this is the "fake success" case and must be rejected.
        assert_eq!(
            evaluate_version_check(true, None, Some("1.2.3")),
            VersionCheckOutcome::NoVersion
        );
    }

    #[test]
    fn evaluate_version_check_missing_version_without_target_succeeds() {
        // Some installers can only prove presence. Without a target version,
        // preserve the old success behavior when verify() passed.
        assert_eq!(
            evaluate_version_check(true, None, None),
            VersionCheckOutcome::Ok
        );
    }
}
