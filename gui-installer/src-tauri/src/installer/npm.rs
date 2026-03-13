use tauri::AppHandle;
use tokio::time::Duration;

use super::{BoxFuture, ToolInstaller};
#[cfg(not(target_os = "windows"))]
use std::process::Command;
#[cfg(target_os = "windows")]
use crate::installer::windows::{hidden_command, refresh_path_win, CREATE_NO_WINDOW};
use crate::types::{DetectResult, InstallResult, InstallerError};

pub const NPM_REGISTRY: &str = "https://registry.npmmirror.com/";

const CLAUDE_CMD: &str = "claude";
const CLAUDE_ARGS: &[&str] = &["--version"];
const CLAUDE_PKG: &str = "@anthropic-ai/claude-code";

const CODEX_CMD: &str = "codex";
const CODEX_ARGS: &[&str] = &["--version"];
const CODEX_PKG: &str = "@openai/codex";

const GEMINI_CMD: &str = "gemini";
const GEMINI_ARGS: &[&str] = &["--version"];
const GEMINI_PKG: &str = "@google/gemini-cli";

pub struct ClaudeCliInstaller;

impl ToolInstaller for ClaudeCliInstaller {
    fn name(&self) -> &str {
        "Claude CLI"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(
            async move { detect_result(self.name(), command_version(CLAUDE_CMD, CLAUDE_ARGS)) },
        )
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            npm_install(CLAUDE_PKG).await?;
            Ok(success_result(
                self.name(),
                command_version(CLAUDE_CMD, CLAUDE_ARGS),
                format!("Installed {} from npm registry", self.name()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { command_version(CLAUDE_CMD, CLAUDE_ARGS).is_some() })
    }

    fn dependencies(&self) -> &'static [&'static str] {
        &["Node.js"]
    }
}

pub struct CodexCliInstaller;

impl ToolInstaller for CodexCliInstaller {
    fn name(&self) -> &str {
        "Codex CLI"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(async move { detect_result(self.name(), command_version(CODEX_CMD, CODEX_ARGS)) })
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            npm_install(CODEX_PKG).await?;
            Ok(success_result(
                self.name(),
                command_version(CODEX_CMD, CODEX_ARGS),
                format!("Installed {} from npm registry", self.name()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { command_version(CODEX_CMD, CODEX_ARGS).is_some() })
    }

    fn dependencies(&self) -> &'static [&'static str] {
        &["Node.js"]
    }
}

pub struct GeminiCliInstaller;

impl ToolInstaller for GeminiCliInstaller {
    fn name(&self) -> &str {
        "Gemini CLI"
    }

    fn detect(&self) -> BoxFuture<'_, DetectResult> {
        Box::pin(
            async move { detect_result(self.name(), command_version(GEMINI_CMD, GEMINI_ARGS)) },
        )
    }

    fn install(&self, _app: &AppHandle) -> BoxFuture<'_, Result<InstallResult, InstallerError>> {
        Box::pin(async move {
            npm_install(GEMINI_PKG).await?;
            Ok(success_result(
                self.name(),
                command_version(GEMINI_CMD, GEMINI_ARGS),
                format!("Installed {} from npm registry", self.name()),
            ))
        })
    }

    fn verify(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move { command_version(GEMINI_CMD, GEMINI_ARGS).is_some() })
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

async fn npm_install(pkg: &str) -> Result<(), InstallerError> {
    use tokio::io::AsyncReadExt;

    validate_registry_url(NPM_REGISTRY)?;
    refresh_command_path();
    ensure_node_ready(pkg).await?;

    #[cfg(target_os = "windows")]
    let mut child = {
        tokio::process::Command::new("cmd.exe")
            .arg("/c")
            .arg(format!(
                "npm install -g {pkg}@latest --registry {NPM_REGISTRY}"
            ))
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| install_failed(pkg, format!("failed to spawn npm install: {e}")))?
    };

    #[cfg(not(target_os = "windows"))]
    let mut child = tokio::process::Command::new("npm")
        .arg("install")
        .arg("-g")
        .arg(format!("{pkg}@latest"))
        .arg("--registry")
        .arg(NPM_REGISTRY)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| install_failed(pkg, format!("failed to spawn npm install: {e}")))?;

    let stdout = child.stdout.take().ok_or_else(|| {
        install_failed(pkg, "failed to capture stdout for npm install".to_string())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        install_failed(pkg, "failed to capture stderr for npm install".to_string())
    })?;

    let stdout_task = tokio::spawn(async move {
        let mut stdout = stdout;
        let mut buffer = Vec::new();
        stdout.read_to_end(&mut buffer).await.map(|_| buffer)
    });
    let stderr_task = tokio::spawn(async move {
        let mut stderr = stderr;
        let mut buffer = Vec::new();
        stderr.read_to_end(&mut buffer).await.map(|_| buffer)
    });

    let timeout_result = tokio::time::timeout(Duration::from_secs(180), child.wait()).await;

    match timeout_result {
        Ok(Ok(status)) => {
            let stdout = stdout_task
                .await
                .map_err(|e| install_failed(pkg, format!("failed to join stdout task: {e}")))?
                .map_err(|e| install_failed(pkg, format!("failed to read stdout: {e}")))?;
            let stderr = stderr_task
                .await
                .map_err(|e| install_failed(pkg, format!("failed to join stderr task: {e}")))?
                .map_err(|e| install_failed(pkg, format!("failed to read stderr: {e}")))?;

            if status.success() {
                refresh_command_path();
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&stdout).trim().to_string();
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
            let _ = child.kill().await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            Err(InstallerError::Timeout {
                detail: format!("npm install for {pkg} timed out after 180 seconds"),
                user_message: format!("{pkg} installation timed out"),
            })
        }
    }
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
