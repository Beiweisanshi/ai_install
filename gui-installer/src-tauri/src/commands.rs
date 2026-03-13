use std::collections::HashSet;

use tauri::AppHandle;

use crate::config;
use crate::installer::{self, ToolInstaller};
use crate::types::{AppVersionInfo, ConfigEntry, DetectResult, InstallResult, InstallerError};
use crate::version;

#[cfg(target_os = "macos")]
use crate::installer::macos::{
    CCSwitchInstallerMac, GitInstallerMac, NodeInstallerMac, NushellInstallerMac,
};
use crate::installer::npm::{ClaudeCliInstaller, CodexCliInstaller, GeminiCliInstaller};
#[cfg(target_os = "windows")]
use crate::installer::windows::{
    CCSwitchInstallerWin, GitInstallerWin, NodeInstallerWin, NushellInstallerWin,
};

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
    push_selected(selected, &mut installers, "Claude CLI", ClaudeCliInstaller);
    push_selected(selected, &mut installers, "Codex CLI", CodexCliInstaller);
    push_selected(selected, &mut installers, "Gemini CLI", GeminiCliInstaller);
    push_selected(selected, &mut installers, "CC-Switch", CCSwitchInstallerWin);

    installers
}

#[cfg(target_os = "macos")]
fn build_macos_installers(selected: &HashSet<&str>) -> Vec<Box<dyn ToolInstaller>> {
    let mut installers: Vec<Box<dyn ToolInstaller>> = Vec::new();

    push_selected(selected, &mut installers, "Nushell", NushellInstallerMac);
    push_selected(selected, &mut installers, "Git", GitInstallerMac);
    push_selected(selected, &mut installers, "Node.js", NodeInstallerMac);
    push_selected(selected, &mut installers, "Claude CLI", ClaudeCliInstaller);
    push_selected(selected, &mut installers, "Codex CLI", CodexCliInstaller);
    push_selected(selected, &mut installers, "Gemini CLI", GeminiCliInstaller);
    push_selected(selected, &mut installers, "CC-Switch", CCSwitchInstallerMac);

    installers
}
