use std::collections::HashSet;
use std::time::{Duration, Instant};

use serde::Serialize;

#[cfg(target_os = "windows")]
use crate::installer::windows::hidden_command;

#[cfg(target_os = "windows")]
const WIN_IMAGE_NAMES: &[&str] = &["cc-switch.exe"];
#[cfg(any(target_os = "macos", target_os = "linux"))]
const UNIX_PATTERN: &str = "cc-switch";
const GRACE_MS: u64 = 1500;
const POLL_MS: u64 = 250;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProc {
    pub pid: u32,
    pub name: String,
}

pub fn detect() -> Vec<CcSwitchProc> {
    #[cfg(target_os = "windows")]
    { detect_windows() }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    { detect_unix() }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { Vec::new() }
}

#[cfg(target_os = "windows")]
fn detect_windows() -> Vec<CcSwitchProc> {
    let mut out: Vec<CcSwitchProc> = Vec::new();
    let mut seen: HashSet<u32> = HashSet::new();

    for image in WIN_IMAGE_NAMES {
        let output = hidden_command("tasklist")
            .arg("/FI")
            .arg(format!("IMAGENAME eq {image}"))
            .arg("/FO")
            .arg("CSV")
            .arg("/NH")
            .output();
        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("INFO:") {
                continue;
            }
            // CSV: "image","pid","session","sessNum","memUsage"
            let mut cols = csv_unquote(trimmed);
            if cols.len() < 2 {
                continue;
            }
            let pid_str = cols.remove(1);
            let Ok(pid) = pid_str.parse::<u32>() else { continue };
            if seen.insert(pid) {
                out.push(CcSwitchProc { pid, name: (*image).to_string() });
            }
        }
    }

    out
}

#[cfg(target_os = "windows")]
fn csv_unquote(line: &str) -> Vec<String> {
    let trimmed = line.trim_matches('"');
    trimmed.split("\",\"").map(|s| s.to_string()).collect()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn detect_unix() -> Vec<CcSwitchProc> {
    use std::process::Command;

    // `pgrep -lif <pat>`: case-insensitive, full-cmdline match, prints "pid name"
    // per line. One spawn covers both pid discovery and name lookup.
    let output = Command::new("pgrep").args(["-lif", UNIX_PATTERN]).output();
    let Ok(output) = output else { return Vec::new() };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut seen: HashSet<u32> = HashSet::new();
    let mut out: Vec<CcSwitchProc> = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        let (pid_str, name_part) = match line.split_once(char::is_whitespace) {
            Some((p, n)) => (p, n.trim()),
            None => (line, ""),
        };
        let Ok(pid) = pid_str.parse::<u32>() else { continue };
        if !seen.insert(pid) {
            continue;
        }
        let name = if name_part.is_empty() { UNIX_PATTERN.to_string() } else { name_part.to_string() };
        out.push(CcSwitchProc { pid, name });
    }
    out
}

pub fn graceful_close(pids: &[u32]) -> usize {
    if pids.is_empty() {
        return 0;
    }

    #[cfg(target_os = "windows")]
    {
        // taskkill without /F sends WM_CLOSE — gives the GUI a chance to flush
        // its SQLite WAL and exit cleanly before we resort to /F.
        let mut cmd = hidden_command("taskkill");
        cmd.arg("/T");
        for pid in pids {
            cmd.arg("/PID").arg(pid.to_string());
        }
        match cmd.status() {
            Ok(status) if status.success() => pids.len(),
            _ => 0,
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    { signal_pids_unix(pids, "-TERM") }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { let _ = pids; 0 }
}

pub fn force_kill(pids: &[u32]) -> usize {
    if pids.is_empty() {
        return 0;
    }

    #[cfg(target_os = "windows")]
    { crate::installer::windows::kill_processes_by_pid(pids) }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    { signal_pids_unix(pids, "-KILL") }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { let _ = pids; 0 }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn signal_pids_unix(pids: &[u32], signal: &str) -> usize {
    use std::process::Command;
    pids.iter()
        .filter(|pid| {
            Command::new("kill")
                .args([signal, &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        })
        .count()
}

/// Try to close gracefully; if any of the provided PIDs is still alive after
/// `GRACE_MS`, escalate to a force kill on the survivors. Returns the number
/// of PIDs no longer alive at the end.
pub fn close_with_grace_period(pids: &[u32]) -> usize {
    if pids.is_empty() {
        return 0;
    }
    graceful_close(pids);

    let deadline = Instant::now() + Duration::from_millis(GRACE_MS);
    let poll = Duration::from_millis(POLL_MS);
    while Instant::now() < deadline {
        if survivors(pids).is_empty() {
            return pids.len();
        }
        std::thread::sleep(poll);
    }

    let still_here = survivors(pids);
    if !still_here.is_empty() {
        force_kill(&still_here);
    }
    pids.len() - survivors(pids).len()
}

fn survivors(pids: &[u32]) -> Vec<u32> {
    let alive: HashSet<u32> = detect().into_iter().map(|p| p.pid).collect();
    pids.iter().copied().filter(|p| alive.contains(p)).collect()
}

