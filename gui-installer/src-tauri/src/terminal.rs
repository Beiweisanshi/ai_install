use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::types::EnvVar;

/// Mode catalog mirror — keep in sync with `gui-installer/src/lib/launchModes.ts`.
/// The TS side is the UI source of truth; this is the launcher's authoritative
/// command-line table.  Both sides enumerate the same `(tool, id)` set in tests.
#[derive(Debug, Clone, Copy)]
struct ModeSpec {
    id: &'static str,
    args: &'static [&'static str],
    envs: &'static [(&'static str, &'static str)],
}

const CODEX_MODES: &[ModeSpec] = &[
    ModeSpec { id: "codex.default", args: &["codex"], envs: &[] },
    ModeSpec { id: "codex.read-only", args: &["codex", "-s", "read-only"], envs: &[] },
    ModeSpec { id: "codex.auto", args: &["codex", "-a", "never"], envs: &[] },
    ModeSpec {
        id: "codex.dangerous",
        args: &["codex", "--dangerously-bypass-approvals-and-sandbox"],
        envs: &[],
    },
];

const CLAUDE_MODES: &[ModeSpec] = &[
    ModeSpec { id: "claude.default", args: &["claude"], envs: &[] },
    ModeSpec { id: "claude.acceptEdits", args: &["claude", "--permission-mode", "acceptEdits"], envs: &[] },
    ModeSpec { id: "claude.plan", args: &["claude", "--permission-mode", "plan"], envs: &[] },
    ModeSpec { id: "claude.auto", args: &["claude", "--permission-mode", "auto"], envs: &[] },
    ModeSpec { id: "claude.dangerous", args: &["claude", "--dangerously-skip-permissions"], envs: &[] },
];

const GEMINI_MODES: &[ModeSpec] = &[
    ModeSpec { id: "gemini.default", args: &["gemini"], envs: &[] },
    ModeSpec { id: "gemini.plan", args: &["gemini", "--approval-mode", "plan"], envs: &[] },
    ModeSpec { id: "gemini.auto-edit", args: &["gemini", "--approval-mode", "auto_edit"], envs: &[] },
    ModeSpec { id: "gemini.yolo", args: &["gemini", "--approval-mode", "yolo"], envs: &[] },
];

const OPENCODE_MODES: &[ModeSpec] = &[
    ModeSpec { id: "opencode.default", args: &["opencode"], envs: &[] },
    ModeSpec {
        id: "opencode.allow-all",
        args: &["opencode"],
        envs: &[("OPENCODE_PERMISSION", "allow")],
    },
];

fn modes_for(tool: &str) -> Result<&'static [ModeSpec], String> {
    match tool {
        "codex" => Ok(CODEX_MODES),
        "claude" => Ok(CLAUDE_MODES),
        "gemini" => Ok(GEMINI_MODES),
        "opencode" => Ok(OPENCODE_MODES),
        other => Err(format!("Unsupported tool: {other}")),
    }
}

// `mode_id` is the new-style id, e.g. "codex.read-only".  Legacy front-ends
// may still pass `"normal"` / `"elevated"` — accept those by mapping to the
// catalog's first entry / dangerous-or-last-caution entry respectively.
fn resolve_mode(tool: &str, mode_id: &str) -> Result<&'static ModeSpec, String> {
    let modes = modes_for(tool)?;

    if let Some(spec) = modes.iter().find(|spec| spec.id == mode_id) {
        return Ok(spec);
    }

    let alias_id = match mode_id {
        "normal" => modes.first().map(|m| m.id),
        "elevated" => modes
            .iter()
            .find(|spec| spec.id.ends_with(".dangerous"))
            .map(|m| m.id)
            .or_else(|| modes.iter().rev().find(|spec| !spec.envs.is_empty() || spec.args.len() > 1).map(|m| m.id))
            .or_else(|| modes.last().map(|m| m.id)),
        _ => None,
    };

    if let Some(id) = alias_id {
        if let Some(spec) = modes.iter().find(|spec| spec.id == id) {
            return Ok(spec);
        }
    }

    Err(format!("Unsupported launch mode: {mode_id}"))
}

// Reject paths that would let a caller break out of the `pushd "{}"` quoting
// in the generated batch script (line continuation, embedded quotes, NUL).
// Newline & NUL are also illegal on every supported platform.
fn validate_cwd(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Working directory must not be empty".to_string());
    }
    for ch in path.chars() {
        if ch == '"' || ch == '\r' || ch == '\n' || ch == '\0' {
            return Err(
                "Working directory must not contain quotes, newlines, or NUL".to_string(),
            );
        }
    }
    Ok(())
}

pub fn launch_ai_tool(
    tool: &str,
    mode: &str,
    cwd: Option<String>,
    env_vars: Option<Vec<EnvVar>>,
) -> Result<(), String> {
    let spec = resolve_mode(tool, mode)?;
    if let Some(ref path) = cwd {
        validate_cwd(path)?;
    }
    let launch_cwd = cwd.map(PathBuf::from);
    let mut lines = env_lines(env_vars.unwrap_or_default())?;
    lines.extend(command_lines(spec));
    launch_terminal_script(tool, &lines, launch_cwd.as_deref())
}

fn command_lines(spec: &ModeSpec) -> Vec<String> {
    let mut lines = Vec::with_capacity(spec.envs.len() + 1);
    for (name, value) in spec.envs {
        lines.push(env_set_line(name, value));
    }
    lines.push(spec.args.join(" "));
    lines
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
        format!("zhima_{tool}_{pid}.cmd")
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("zhima_{tool}_{pid}.sh")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_for_unknown_tool_errors() {
        assert!(modes_for("vscode").is_err());
    }

    #[test]
    fn resolve_mode_table_driven_all_ids() {
        let table: &[(&str, &[&str])] = &[
            (
                "codex",
                &["codex.default", "codex.read-only", "codex.auto", "codex.dangerous"],
            ),
            (
                "claude",
                &[
                    "claude.default",
                    "claude.acceptEdits",
                    "claude.plan",
                    "claude.auto",
                    "claude.dangerous",
                ],
            ),
            (
                "gemini",
                &["gemini.default", "gemini.plan", "gemini.auto-edit", "gemini.yolo"],
            ),
            ("opencode", &["opencode.default", "opencode.allow-all"]),
        ];

        for (tool, ids) in table {
            for id in *ids {
                let spec = resolve_mode(tool, id)
                    .unwrap_or_else(|e| panic!("expected {tool}/{id} to resolve: {e}"));
                assert_eq!(spec.id, *id);
                assert!(!spec.args.is_empty(), "{id} must have at least one arg");
            }
        }
    }

    #[test]
    fn resolve_mode_legacy_normal_alias() {
        for tool in ["codex", "claude", "gemini", "opencode"] {
            let spec = resolve_mode(tool, "normal").expect("normal should alias");
            assert_eq!(spec.id, format!("{tool}.default"));
        }
    }

    #[test]
    fn resolve_mode_legacy_elevated_alias() {
        assert_eq!(resolve_mode("codex", "elevated").unwrap().id, "codex.dangerous");
        assert_eq!(resolve_mode("claude", "elevated").unwrap().id, "claude.dangerous");
        assert_eq!(resolve_mode("gemini", "elevated").unwrap().id, "gemini.yolo");
        assert_eq!(
            resolve_mode("opencode", "elevated").unwrap().id,
            "opencode.allow-all"
        );
    }

    #[test]
    fn resolve_mode_unknown_id_errors() {
        assert!(resolve_mode("codex", "nope").is_err());
        assert!(resolve_mode("claude", "yolo").is_err());
    }

    #[test]
    fn resolve_mode_unknown_tool_errors() {
        assert!(resolve_mode("vscode", "default").is_err());
    }

    #[test]
    fn validate_cwd_accepts_normal_paths() {
        assert!(validate_cwd("D:\\study\\ai_download\\ai_install").is_ok());
        assert!(validate_cwd("/home/user/project").is_ok());
        assert!(validate_cwd("C:/Program Files/foo").is_ok());
    }

    #[test]
    fn validate_cwd_rejects_dangerous_chars() {
        assert!(validate_cwd("").is_err());
        assert!(validate_cwd("C:\\foo\"bar").is_err());
        assert!(validate_cwd("C:\\foo\rbar").is_err());
        assert!(validate_cwd("C:\\foo\nbar").is_err());
        assert!(validate_cwd("C:\\foo\0bar").is_err());
    }

    #[test]
    fn command_lines_emits_envs_then_args() {
        let spec = resolve_mode("opencode", "opencode.allow-all").unwrap();
        let lines = command_lines(spec);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("OPENCODE_PERMISSION"));
        assert!(lines[0].contains("allow"));
        assert_eq!(lines[1], "opencode");
    }

    #[test]
    fn command_lines_for_default_is_just_args() {
        let spec = resolve_mode("codex", "codex.default").unwrap();
        let lines = command_lines(spec);
        assert_eq!(lines, vec!["codex".to_string()]);
    }

    #[test]
    fn command_lines_joins_args_with_space() {
        let spec = resolve_mode("claude", "claude.acceptEdits").unwrap();
        let lines = command_lines(spec);
        assert_eq!(lines, vec!["claude --permission-mode acceptEdits".to_string()]);
    }
}
