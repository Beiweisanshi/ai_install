use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::types::EnvVar;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LaunchMode {
    Normal,
    Elevated,
}

impl LaunchMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "normal" => Ok(Self::Normal),
            "elevated" => Ok(Self::Elevated),
            other => Err(format!("Unsupported launch mode: {other}")),
        }
    }
}

pub fn launch_ai_tool(
    tool: &str,
    mode: &str,
    cwd: Option<String>,
    env_vars: Option<Vec<EnvVar>>,
) -> Result<(), String> {
    let mode = LaunchMode::parse(mode)?;
    let launch_cwd = cwd.map(PathBuf::from);
    let mut lines = env_lines(env_vars.unwrap_or_default())?;
    lines.extend(command_lines(tool, mode)?);
    launch_terminal_script(tool, &lines, launch_cwd.as_deref())
}

fn env_lines(env_vars: Vec<EnvVar>) -> Result<Vec<String>, String> {
    env_vars
        .into_iter()
        .map(|item| {
            validate_env_name(&item.name)?;
            validate_env_value(&item.name, &item.value)?;
            Ok(env_set_line(&item.name, &item.value))
        })
        .collect()
}

fn validate_env_value(name: &str, value: &str) -> Result<(), String> {
    // Reject control characters that would break the launch script — CR/LF
    // would split a single `set "K=V"` into multiple lines, and NUL is
    // refused by the shell anyway.  Everything else (including spaces,
    // unicode, `&`, `^`, `%`) is fine because we wrap the value in quotes.
    if value
        .chars()
        .any(|ch| ch == '\r' || ch == '\n' || ch == '\0')
    {
        return Err(format!(
            "Environment variable {name} contains a newline or NUL character"
        ));
    }

    // Windows `set "K=V"` syntax forbids embedded `"` inside the quoted
    // form; PowerShell `set -Item Env:K V` would also choke.  These values
    // come from API keys / URLs in practice, so a literal `"` is almost
    // certainly user error rather than legitimate input.
    #[cfg(target_os = "windows")]
    {
        if value.contains('"') {
            return Err(format!(
                "Environment variable {name} contains a double quote, which is not supported on Windows launch scripts"
            ));
        }
    }

    Ok(())
}

fn validate_env_name(name: &str) -> Result<(), String> {
    let valid = !name.is_empty()
        && name
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
        && name
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_uppercase() || ch == '_');

    if valid {
        Ok(())
    } else {
        Err(format!("Invalid environment variable name: {name}"))
    }
}

fn command_lines(tool: &str, mode: LaunchMode) -> Result<Vec<String>, String> {
    match (tool, mode) {
        ("codex", LaunchMode::Normal) => Ok(vec!["codex".to_string()]),
        ("codex", LaunchMode::Elevated) => Ok(vec![
            "codex --dangerously-bypass-approvals-and-sandbox".to_string(),
        ]),
        ("claude", LaunchMode::Normal) => Ok(vec!["claude".to_string()]),
        ("claude", LaunchMode::Elevated) => {
            Ok(vec!["claude --dangerously-skip-permissions".to_string()])
        }
        ("gemini", LaunchMode::Normal) => Ok(vec!["gemini".to_string()]),
        ("gemini", LaunchMode::Elevated) => Ok(vec!["gemini --yolo".to_string()]),
        ("opencode", LaunchMode::Normal) => Ok(vec!["opencode".to_string()]),
        ("opencode", LaunchMode::Elevated) => Ok(vec![
            env_set_line("OPENCODE_PERMISSION", "allow"),
            "opencode".to_string(),
        ]),
        _ => Err(format!("Unsupported tool: {tool}")),
    }
}

fn launch_terminal_script(tool: &str, lines: &[String], cwd: Option<&Path>) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(script_name(tool));

    #[cfg(target_os = "windows")]
    {
        fs::write(&script_path, windows_script(lines, cwd))
            .map_err(|e| format!("Failed to write launch script: {e}"))?;
        return launch_windows_terminal(&script_path, tool);
    }

    #[cfg(not(target_os = "windows"))]
    {
        fs::write(&script_path, unix_script(lines, cwd))
            .map_err(|e| format!("Failed to write launch script: {e}"))?;
        set_executable(&script_path)?;
    }

    #[cfg(target_os = "macos")]
    {
        return launch_macos_terminal(&script_path);
    }

    #[cfg(target_os = "linux")]
    {
        return launch_linux_terminal(&script_path);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = script_path;
        Err("Unsupported platform".to_string())
    }
}

fn script_name(tool: &str) -> String {
    let pid = std::process::id();
    #[cfg(target_os = "windows")]
    {
        format!("zm_tools_{tool}_{pid}.cmd")
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("zm_tools_{tool}_{pid}.sh")
    }
}

#[cfg(target_os = "windows")]
fn windows_script(lines: &[String], cwd: Option<&Path>) -> String {
    let mut script = String::from("@echo off\r\n");
    if let Some(cwd) = cwd {
        script.push_str(&format!("pushd \"{}\"\r\n", cwd.display()));
    }
    for line in lines {
        script.push_str(line);
        script.push_str("\r\n");
    }
    script.push_str(
        "\r\necho.\r\necho Command exited. Press any key to close this window.\r\npause >nul\r\n",
    );
    script
}

#[cfg(not(target_os = "windows"))]
fn unix_script(lines: &[String], cwd: Option<&Path>) -> String {
    let mut script = String::from("#!/usr/bin/env bash\nset -e\n");
    if let Some(cwd) = cwd {
        script.push_str(&format!("cd {}\n", shell_quote(&cwd.display().to_string())));
    }
    for line in lines {
        script.push_str(line);
        script.push('\n');
    }
    script.push_str("\necho\necho 'Command exited. Press Enter to close this window.'\nread -r _\n");
    script
}

#[cfg(target_os = "windows")]
fn env_set_line(name: &str, value: &str) -> String {
    format!("set \"{name}={value}\"")
}

#[cfg(not(target_os = "windows"))]
fn env_set_line(name: &str, value: &str) -> String {
    format!("export {name}={}", shell_quote(value))
}

#[cfg(not(target_os = "windows"))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(not(target_os = "windows"))]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|e| format!("Failed to inspect launch script: {e}"))?
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(path, permissions)
        .map_err(|e| format!("Failed to make launch script executable: {e}"))
}

#[cfg(target_os = "windows")]
fn launch_windows_terminal(script_path: &Path, label: &str) -> Result<(), String> {
    let script = script_path.to_string_lossy().to_string();

    if Command::new("wt")
        .args(["--title", label, "cmd", "/K", &script])
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    Command::new("cmd")
        .args(["/C", "start", "", "cmd", "/K", &script])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch terminal: {e}"))
}

#[cfg(target_os = "macos")]
fn launch_macos_terminal(script_path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg("-a")
        .arg("Terminal")
        .arg(script_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch Terminal.app: {e}"))
}

#[cfg(target_os = "linux")]
fn launch_linux_terminal(script_path: &Path) -> Result<(), String> {
    let script = script_path.to_string_lossy().to_string();
    let candidates: [(&str, &[&str]); 5] = [
        ("x-terminal-emulator", &["-e", "bash"]),
        ("gnome-terminal", &["--", "bash"]),
        ("konsole", &["-e", "bash"]),
        ("xfce4-terminal", &["-e", "bash"]),
        ("xterm", &["-e", "bash"]),
    ];

    for (terminal, args) in candidates {
        if Command::new(terminal)
            .args(args)
            .arg(&script)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }

    Err("No supported terminal emulator found".to_string())
}
