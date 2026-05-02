use std::collections::HashSet;

use tauri::AppHandle;

use crate::config;
use crate::installer::{self, ToolInstaller};
use crate::types::{
    AppVersionInfo, ConfigEntry, DetectResult, EnvVar, InstallResult, InstallerError, RunningProc,
};
use crate::version;
use crate::backend::{BackendRequest, BackendResponse};

#[cfg(target_os = "macos")]
use crate::installer::macos::{GitInstallerMac, NodeInstallerMac, NushellInstallerMac};
use crate::installer::npm::NpmCliInstaller;
#[cfg(target_os = "windows")]
use crate::installer::windows::{GitInstallerWin, NodeInstallerWin, NushellInstallerWin};

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
    config::save_all_configs(entries).map_err(String::from)
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
pub async fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Unsupported URL".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
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
