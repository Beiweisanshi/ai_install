use std::collections::HashSet;

use tauri::AppHandle;

use crate::config;
use crate::channel_config::{self, ActiveSettings, ChannelPayload};
use crate::installer::{self, ToolInstaller};
use crate::types::{
    AppVersionInfo, ConfigEntry, DetectResult, EnvVar, EnvVarInfo, InstallResult, InstallerError,
    PrecheckResult, RunningProc,
};
use crate::version;
use crate::backend::{BackendRequest, BackendResponse};

#[cfg(target_os = "macos")]
use crate::installer::macos::{GitInstallerMac, NodeInstallerMac, NushellInstallerMac};
use crate::installer::npm::NpmCliInstaller;
#[cfg(target_os = "windows")]
use crate::installer::windows::{GitInstallerWin, NodeInstallerWin, NushellInstallerWin};

/// Single source of truth for environment variables this app manages on
/// behalf of the user. `list_managed_env_vars` and `clear_managed_env_var`
/// must agree — keep them tied to this constant.
pub(crate) const MANAGED_ENV_VAR_NAMES: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "GEMINI_API_KEY",
    "GOOGLE_GEMINI_BASE_URL",
    "GEMINI_MODEL",
    "OPENCODE_PERMISSION",
];

#[tauri::command]
pub async fn detect_tools(_app: AppHandle) -> Result<Vec<DetectResult>, String> {
    let packages_dir = installer::locate_packages_dir().ok();
    Ok(installer::detect::detect_all_tools(packages_dir.as_deref()))
}

#[tauri::command]
pub async fn install_tools(
    app: AppHandle,
    tools: Vec<String>,
) -> Result<Vec<InstallResult>, String> {
    let selected: HashSet<&str> = tools.iter().map(String::as_str).collect();
    let installers = build_installers(&selected).map_err(String::from)?;
    let mut results = installer::dispatch_installers(installers, &app).await;

    if let Some(report_path) = installer::write_install_report(&tools, &results) {
        let suffix = format!(" Detailed report: {}", report_path.display());
        for result in &mut results {
            if !result.success && !result.message.contains("Detailed report:") {
                result.message.push_str(&suffix);
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn save_config(entries: Vec<ConfigEntry>) -> Result<(), String> {
    #[allow(deprecated)]
    {
        config::save_all_configs(entries).map_err(String::from)
    }
}

#[tauri::command]
pub async fn apply_active_channel(channel: ChannelPayload) -> Result<(), String> {
    channel_config::apply_active_channel(channel)
}

#[tauri::command]
pub async fn read_active_settings() -> Result<ActiveSettings, String> {
    channel_config::read_active_settings()
}

#[tauri::command]
pub async fn get_app_version_info() -> Result<AppVersionInfo, String> {
    Ok(version::get_app_version_info())
}

/// Return processes currently holding the given npm package's files open.
/// On non-Windows platforms returns an empty list.
#[tauri::command]
pub async fn list_blocking_processes(pkg: String) -> Result<Vec<RunningProc>, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(installer::windows::find_running_cli_processes(&pkg))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = pkg;
        Ok(Vec::new())
    }
}

/// Forcefully terminate the given PIDs (taskkill /F /T on Windows).
/// Returns the number of processes successfully terminated.
#[tauri::command]
pub async fn kill_blocking_processes(pids: Vec<u32>) -> Result<usize, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(installer::windows::kill_processes_by_pid(&pids))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = pids;
        Ok(0)
    }
}

#[tauri::command]
pub async fn precheck_install(tools: Vec<String>) -> Result<PrecheckResult, String> {
    #[cfg(target_os = "windows")]
    {
        let mut seen = HashSet::new();
        let mut blocking_processes = Vec::new();
        for tool in tools {
            let Some(pkg) = npm_pkg_for_tool(&tool) else {
                continue;
            };
            for process in installer::windows::find_running_cli_processes(pkg) {
                if seen.insert(process.pid) {
                    blocking_processes.push(process);
                }
            }
        }

        Ok(PrecheckResult {
            disk_free_mb: windows_disk_free_mb().unwrap_or(0),
            blocking_processes,
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = tools;
        Ok(PrecheckResult {
            disk_free_mb: 0,
            blocking_processes: Vec::new(),
        })
    }
}

#[tauri::command]
pub async fn launch_ai_tool(
    tool: String,
    mode: String,
    cwd: Option<String>,
    env_vars: Option<Vec<EnvVar>>,
) -> Result<(), String> {
    crate::terminal::launch_ai_tool(&tool, &mode, cwd, env_vars)
}

#[tauri::command]
pub async fn backend_request(input: BackendRequest) -> Result<BackendResponse, String> {
    crate::backend::request_backend(input).await
}

#[tauri::command]
pub fn secure_session_get(app: AppHandle) -> Result<Option<String>, String> {
    crate::secure_store::get_session(app)
}

#[tauri::command]
pub fn secure_session_set(app: AppHandle, session: String) -> Result<(), String> {
    crate::secure_store::set_session(app, session)
}

#[tauri::command]
pub fn secure_session_clear(app: AppHandle) -> Result<(), String> {
    crate::secure_store::clear_session(app)
}

#[tauri::command]
pub fn list_managed_env_vars() -> Result<Vec<EnvVarInfo>, String> {
    Ok(MANAGED_ENV_VAR_NAMES
        .iter()
        .map(|name| EnvVarInfo {
            name: (*name).to_string(),
            value: managed_env_var_value(name),
        })
        .collect())
}

#[tauri::command]
pub fn clear_managed_env_var(name: String) -> Result<(), String> {
    if !MANAGED_ENV_VAR_NAMES.contains(&name.as_str()) {
        return Err("Unsupported environment variable".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        delete_user_env_var_windows(&name)?;
        unsafe {
            std::env::remove_var(&name);
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        unsafe {
            std::env::remove_var(&name);
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn delete_user_env_var_windows(name: &str) -> Result<(), String> {
    let status = installer::windows::hidden_command("reg")
        .args(["delete", "HKCU\\Environment", "/v", name, "/f"])
        .status()
        .map_err(|error| format!("Failed to delete env var: {error}"))?;
    if status.success() || !user_env_var_exists_windows(name) {
        return Ok(());
    }
    Err(format!("reg delete failed with status {status}"))
}

#[cfg(target_os = "windows")]
fn user_env_var_exists_windows(name: &str) -> bool {
    installer::windows::hidden_command("reg")
        .args(["query", "HKCU\\Environment", "/v", name])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn logs_dir() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| "LOCALAPPDATA is not set".to_string())?;
        return Ok(std::path::PathBuf::from(local_app_data)
            .join("gui-installer")
            .join("logs")
            .display()
            .to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(std::env::temp_dir()
            .join("gui-installer")
            .join("logs")
            .display()
            .to_string())
    }
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::fs::create_dir_all(&path).ok();
        installer::windows::hidden_command("explorer")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open path: {error}"))
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open path: {error}"))
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open path: {error}"))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Err("Unsupported platform".to_string())
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Unsupported URL".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut command = std::process::Command::new("cmd");
        command
            .args(["/C", "start", "", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open browser: {error}"))
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open browser: {error}"))
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open browser: {error}"))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = url;
        Err("Unsupported platform".to_string())
    }
}

fn npm_pkg_for_tool(tool: &str) -> Option<&'static str> {
    match tool {
        "Claude CLI" => Some("@anthropic-ai/claude-code"),
        "Codex CLI" => Some("@openai/codex"),
        "Gemini CLI" => Some("@google/gemini-cli"),
        "OpenCode" => Some("opencode-ai"),
        _ => None,
    }
}

fn managed_env_var_value(name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        read_user_env_var_windows(name).or_else(|| std::env::var(name).ok())
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var(name).ok()
    }
}

#[cfg(target_os = "windows")]
fn read_user_env_var_windows(name: &str) -> Option<String> {
    let output = installer::windows::hidden_command("reg")
        .args(["query", "HKCU\\Environment", "/v", name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().find_map(|line| {
        let trimmed = line.trim();
        if !trimmed.starts_with(name) {
            return None;
        }
        let marker = if trimmed.contains("REG_EXPAND_SZ") {
            "REG_EXPAND_SZ"
        } else if trimmed.contains("REG_SZ") {
            "REG_SZ"
        } else {
            return None;
        };
        let (_, value) = trimmed.split_once(marker)?;
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

#[cfg(target_os = "windows")]
fn windows_disk_free_mb() -> Option<u64> {
    let current_dir = std::env::current_dir().ok()?;
    let drive = current_dir
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .unwrap_or("C:");
    let script = format!(
        "(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='{drive}'\").FreeSpace"
    );
    let output = installer::windows::hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let bytes = raw.trim().parse::<u64>().ok()?;
    Some(bytes / 1024 / 1024)
}

fn push_selected<T>(
    selected: &HashSet<&str>,
    installers: &mut Vec<Box<dyn ToolInstaller>>,
    name: &str,
    installer: T,
) where
    T: ToolInstaller + 'static,
{
    if selected.contains(name) {
        installers.push(Box::new(installer));
    }
}

fn build_installers(
    selected: &HashSet<&str>,
) -> Result<Vec<Box<dyn ToolInstaller>>, InstallerError> {
    #[cfg(target_os = "windows")]
    {
        return Ok(build_windows_installers(selected));
    }

    #[cfg(target_os = "macos")]
    {
        return Ok(build_macos_installers(selected));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err(InstallerError::InstallFailed {
            detail: format!("unsupported target OS: {}", std::env::consts::OS),
            user_message: "Unsupported platform".to_string(),
        })
    }
}

#[cfg(target_os = "windows")]
fn build_windows_installers(selected: &HashSet<&str>) -> Vec<Box<dyn ToolInstaller>> {
    let mut installers: Vec<Box<dyn ToolInstaller>> = Vec::new();

    push_selected(selected, &mut installers, "Nushell", NushellInstallerWin);
    push_selected(selected, &mut installers, "Git", GitInstallerWin);
    push_selected(selected, &mut installers, "Node.js", NodeInstallerWin);
    push_selected(
        selected,
        &mut installers,
        "Claude CLI",
        NpmCliInstaller::claude(),
    );
    push_selected(
        selected,
        &mut installers,
        "Codex CLI",
        NpmCliInstaller::codex(),
    );
    push_selected(
        selected,
        &mut installers,
        "Gemini CLI",
        NpmCliInstaller::gemini(),
    );
    push_selected(
        selected,
        &mut installers,
        "OpenCode",
        NpmCliInstaller::opencode(),
    );

    installers
}

#[cfg(target_os = "macos")]
fn build_macos_installers(selected: &HashSet<&str>) -> Vec<Box<dyn ToolInstaller>> {
    let mut installers: Vec<Box<dyn ToolInstaller>> = Vec::new();

    push_selected(selected, &mut installers, "Nushell", NushellInstallerMac);
    push_selected(selected, &mut installers, "Git", GitInstallerMac);
    push_selected(selected, &mut installers, "Node.js", NodeInstallerMac);
    push_selected(
        selected,
        &mut installers,
        "Claude CLI",
        NpmCliInstaller::claude(),
    );
    push_selected(
        selected,
        &mut installers,
        "Codex CLI",
        NpmCliInstaller::codex(),
    );
    push_selected(
        selected,
        &mut installers,
        "Gemini CLI",
        NpmCliInstaller::gemini(),
    );
    push_selected(
        selected,
        &mut installers,
        "OpenCode",
        NpmCliInstaller::opencode(),
    );

    installers
}
