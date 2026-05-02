use tauri::AppHandle;
use tokio::time::Duration;

use super::{BoxFuture, ToolInstaller, emit_progress};
#[cfg(target_os = "windows")]
use crate::installer::windows::{
    CREATE_NO_WINDOW, find_running_cli_processes, hidden_command, refresh_path_win,
};
use crate::types::{DetectResult, InstallResult, InstallerError};
#[cfg(not(target_os = "windows"))]
use std::process::Command;

pub const NPM_REGISTRY: &str = "https://registry.npmmirror.com/";

pub struct NpmCliInstaller {
    name: &'static str,
    cmd: &'static str,
    args: &'static [&'static str],
    pkg: &'static str,
}

impl NpmCliInstaller {
    pub const fn claude() -> Self {
        Self {
            name: "Claude CLI",
            cmd: "claude",
            args: &["--version"],
            pkg: "@anthropic-ai/claude-code",
        }
    }

    pub const fn codex() -> Self {
        Self {
            name: "Codex CLI",
            cmd: "codex",
            args: &["--version"],
            pkg: "@openai/codex",
        }
    }

    pub const fn gemini() -> Self {
        Self {
            name: "Gemini CLI",
            cmd: "gemini",
            args: &["--version"],
            pkg: "@google/gemini-cli",
        }
    }

    pub const fn opencode() -> Self {
        Self {
            name: "OpenCode",
            cmd: "opencode",
            args: &["--version"],
            pkg: "opencode-ai",
        }
    }
}

impl ToolInstaller for NpmCliInstaller {
    fn name(&self) -> &str {
        self.name
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name, command_version(self.cmd, self.args)) })
    }

    fn target_version(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move { super::detect::get_npm_available_version(self.pkg) })
    }

    fn install(&self, app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        let app = app.clone();
        Box::pin(async move {
            npm_install(&app, self.name, self.pkg).await?;
            Ok(success_result(
                self.name,
                command_version(self.cmd, self.args),
                format!("Installed {} from npm registry", self.name),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { command_version(self.cmd, self.args).is_some() })
    }

    fn dependencies(&self) -> &'static [&'static str] {
        &["Node.js"]
    }
}

fn validate_registry_url(url: &str) -> Result<(), InstallerError> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err(InstallerError::InvalidInput {
            detail: format!("npm registry must use https: {url}"),
            user_message: "Invalid npm registry URL".to_string(),
        })
    }
}

const NPM_LOG_EMIT_CAP: usize = 200;
const NPM_LOG_COLLECT_CAP: usize = 16 * 1024;

fn spawn_log_reader<R>(
    stream: R,
    app: AppHandle,
    tool_name: String,
) -> tokio::task::JoinHandle<String>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    use tokio::io::{AsyncBufReadExt, BufReader};

    tokio::spawn(async move {
        let mut reader = BufReader::new(stream).lines();
        let mut collected = String::new();
        let mut emitted = 0usize;
        while let Ok(Some(line)) = reader.next_line().await {
            if collected.len() < NPM_LOG_COLLECT_CAP {
                collected.push_str(&line);
                collected.push('\n');
            }
            if emitted < NPM_LOG_EMIT_CAP {
                emit_progress(&app, &tool_name, "installing", 50, &line);
                emitted += 1;
            }
        }
        collected
    })
}

async fn npm_install(app: &AppHandle, tool_name: &str, pkg: &str) -> Result<(), InstallerError> {
    validate_registry_url(NPM_REGISTRY)?;
    refresh_command_path();
    ensure_node_ready(pkg).await?;

    // Preflight: refuse to upgrade if the target CLI is still running — the
    // npm shim files (%APPDATA%\npm\<cli>.cmd, .ps1) and the package
    // directory would be locked, causing npm to loop on EBUSY indefinitely.
    #[cfg(target_os = "windows")]
    {
        let processes = find_running_cli_processes(pkg);
        if !processes.is_empty() {
            let pids: Vec<String> = processes.iter().map(|p| p.pid.to_string()).collect();
            return Err(InstallerError::Blocked {
                user_message: format!(
                    "Close all running {tool_name} windows before upgrading. \
                     Detected {} process(es): PID {}",
                    processes.len(),
                    pids.join(", ")
                ),
                detail: format!(
                    "blocking processes for {pkg}: {}",
                    processes
                        .iter()
                        .map(|p| format!("{}({})", p.name, p.pid))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                processes,
            });
        }
    }

    let spawn_result = spawn_npm_install(pkg);
    let mut child = spawn_result?;

    let stdout = child.stdout.take().ok_or_else(|| {
        install_failed(pkg, "failed to capture stdout for npm install".to_string())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        install_failed(pkg, "failed to capture stderr for npm install".to_string())
    })?;

    let stdout_task = spawn_log_reader(stdout, app.clone(), tool_name.to_string());
    let stderr_task = spawn_log_reader(stderr, app.clone(), tool_name.to_string());

    let timeout_result = tokio::time::timeout(Duration::from_secs(180), child.wait()).await;

    match timeout_result {
        Ok(Ok(status)) => {
            let stdout = stdout_task.await.unwrap_or_default();
            let stderr = stderr_task.await.unwrap_or_default();

            if status.success() {
                refresh_command_path();
                Ok(())
            } else {
                let stderr = stderr.trim().to_string();
                let stdout = stdout.trim().to_string();
                let message = if stderr.is_empty() { stdout } else { stderr };
                Err(install_failed(
                    pkg,
                    format!(
                        "npm install exited with status {:?}: {message}",
                        status.code()
                    ),
                ))
            }
        }
        Ok(Err(e)) => Err(install_failed(pkg, format!("npm install IO error: {e}"))),
        Err(_) => {
            // Timeout fired.  Kill the process, then proactively ABORT the
            // reader tasks — on Windows, killing npm does NOT close pipe
            // handles inherited by its node grandchildren, so awaiting the
            // readers here would block forever.
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            stdout_task.abort();
            stderr_task.abort();
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            Err(InstallerError::Timeout {
                detail: format!("npm install for {pkg} timed out after 180 seconds"),
                user_message: format!("{pkg} installation timed out"),
            })
        }
    }
}

#[cfg(target_os = "windows")]
fn spawn_npm_install(pkg: &str) -> Result<tokio::process::Child, InstallerError> {
    let npm_cmd = resolve_npm_cmd().ok_or_else(|| {
        install_failed(
            pkg,
            "npm.cmd not found in PATH or known locations".to_string(),
        )
    })?;
    tokio::process::Command::new(npm_cmd)
        .arg("install")
        .arg("-g")
        .arg(format!("{pkg}@latest"))
        .arg("--registry")
        .arg(NPM_REGISTRY)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| install_failed(pkg, format!("failed to spawn npm install: {e}")))
}

#[cfg(not(target_os = "windows"))]
fn spawn_npm_install(pkg: &str) -> Result<tokio::process::Child, InstallerError> {
    tokio::process::Command::new("npm")
        .arg("install")
        .arg("-g")
        .arg(format!("{pkg}@latest"))
        .arg("--registry")
        .arg(NPM_REGISTRY)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| install_failed(pkg, format!("failed to spawn npm install: {e}")))
}

async fn ensure_node_ready(pkg: &str) -> Result<(), InstallerError> {
    for attempt in 0..3 {
        refresh_command_path();
        let node_version = command_version("node", &["--version"]);
        let npm_version = command_version("npm", &["--version"]);

        if node_version.is_some() && npm_version.is_some() {
            return Ok(());
        }

        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    }

    Err(install_failed(
        pkg,
        "Node.js or npm is missing from PATH after retries; install Node.js successfully before npm tools"
            .to_string(),
    ))
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
        required: false,
        group: "npm".to_string(),
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
    refresh_command_path();

    #[cfg(target_os = "windows")]
    let output = command_output_windows(program, args)?;

    #[cfg(not(target_os = "windows"))]
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

#[cfg(target_os = "windows")]
fn command_output_windows(program: &str, args: &[&str]) -> Option<std::process::Output> {
    for candidate in [
        format!("{program}.cmd"),
        format!("{program}.exe"),
        program.to_string(),
    ] {
        let output = hidden_command(&candidate).args(args).output().ok();
        if output.is_some() {
            return output;
        }
    }

    None
}

fn refresh_command_path() {
    #[cfg(target_os = "windows")]
    {
        let _ = refresh_path_win();
    }
}

fn install_failed(target: &str, detail: impl Into<String>) -> InstallerError {
    let detail = detail.into();
    InstallerError::InstallFailed {
        user_message: format!("{target} installation failed"),
        detail,
    }
}

#[cfg(target_os = "windows")]
fn resolve_npm_cmd() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    refresh_command_path();

    // Check known install locations first
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let npm_cmd = PathBuf::from(app_data).join("npm").join("npm.cmd");
        if npm_cmd.is_file() {
            return Some(npm_cmd);
        }
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let npm_cmd = PathBuf::from(program_files).join("nodejs").join("npm.cmd");
        if npm_cmd.is_file() {
            return Some(npm_cmd);
        }
    }

    // Fallback: search current PATH
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join("npm.cmd");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::validate_registry_url;

    #[test]
    fn test_validate_registry_url() {
        assert!(validate_registry_url("https://registry.npmjs.org/").is_ok());
        assert!(validate_registry_url("http://registry.npmjs.org/").is_err());
        assert!(validate_registry_url("ftp://registry.npmjs.org/").is_err());
    }
}
