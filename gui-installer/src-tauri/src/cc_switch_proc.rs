use std::collections::HashSet;
use std::time::{Duration, Instant};

use serde::Serialize;

#[cfg(target_os = "windows")]
use crate::installer::windows::hidden_command;

/// Image / executable names to look for. cc-switch v3 ships as a Tauri app
/// whose Windows binary is `cc-switch.exe` and whose macOS bundle exposes
/// `cc-switch` (and historically `Cc-switch`) inside `*.app/Contents/MacOS/`.
const IMAGE_NAMES: &[&str] = &["cc-switch.exe", "cc-switch", "Cc-switch"];

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProcInfo {
    pub pids: Vec<u32>,
    pub exe_paths: Vec<String>,
}

pub fn detect() -> CcSwitchProcInfo {
    #[cfg(target_os = "windows")]
    {
        detect_windows()
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        detect_unix()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        CcSwitchProcInfo::default()
    }
}

#[cfg(target_os = "windows")]
fn detect_windows() -> CcSwitchProcInfo {
    let mut pids: Vec<u32> = Vec::new();
    let mut exe_paths: Vec<String> = Vec::new();
    let mut seen: HashSet<u32> = HashSet::new();

    for image in IMAGE_NAMES {
        if !image.ends_with(".exe") {
            continue;
        }
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
                pids.push(pid);
                exe_paths.push((*image).to_string());
            }
        }
    }

    CcSwitchProcInfo { pids, exe_paths }
}

#[cfg(target_os = "windows")]
fn csv_unquote(line: &str) -> Vec<String> {
    // tasklist CSV uses double-quoted fields separated by commas. Values do
    // not contain commas (image names, decimal pids, etc.), so a simple split
    // on `","` after stripping the leading/trailing quote is enough.
    let trimmed = line.trim_matches('"');
    trimmed.split("\",\"").map(|s| s.to_string()).collect()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn detect_unix() -> CcSwitchProcInfo {
    use std::process::Command;
    let mut pids: Vec<u32> = Vec::new();
    let mut exe_paths: Vec<String> = Vec::new();
    let mut seen: HashSet<u32> = HashSet::new();

    // `pgrep -if pattern` — case-insensitive, full-cmdline match. We use the
    // shortest unique fragment so both bare binary and .app bundle paths are
    // captured.
    let output = Command::new("pgrep").args(["-if", "cc-switch"]).output();
    let Ok(output) = output else {
        return CcSwitchProcInfo::default();
    };
    if !output.status.success() {
        return CcSwitchProcInfo::default();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let Ok(pid) = line.trim().parse::<u32>() else { continue };
        if !seen.insert(pid) {
            continue;
        }
        // ps -o comm= for the image name; ignore failures.
        let exe = Command::new("ps")
            .args(["-o", "comm=", "-p", &pid.to_string()])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "cc-switch".to_string());
        pids.push(pid);
        exe_paths.push(exe);
    }
    CcSwitchProcInfo { pids, exe_paths }
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
    {
        use std::process::Command;
        let mut count = 0;
        for pid in pids {
            let ok = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                count += 1;
            }
        }
        count
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = pids;
        0
    }
}

pub fn force_kill(pids: &[u32]) -> usize {
    if pids.is_empty() {
        return 0;
    }

    #[cfg(target_os = "windows")]
    {
        crate::installer::windows::kill_processes_by_pid(pids)
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::process::Command;
        let mut count = 0;
        for pid in pids {
            let ok = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                count += 1;
            }
        }
        count
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = pids;
        0
    }
}

/// Try to close gracefully; if any of the provided PIDs is still alive after
/// `grace_ms`, escalate to a force kill on the survivors. Returns the number
/// of PIDs no longer alive at the end.
pub fn close_with_grace_period(pids: &[u32], grace_ms: u64) -> usize {
    if pids.is_empty() {
        return 0;
    }
    graceful_close(pids);

    let deadline = Instant::now() + Duration::from_millis(grace_ms);
    let poll = Duration::from_millis(250);
    while Instant::now() < deadline {
        let alive = detect();
        let alive_set: HashSet<u32> = alive.pids.iter().copied().collect();
        let still_here: Vec<u32> = pids.iter().copied().filter(|p| alive_set.contains(p)).collect();
        if still_here.is_empty() {
            return pids.len();
        }
        std::thread::sleep(poll);
    }

    let alive = detect();
    let alive_set: HashSet<u32> = alive.pids.iter().copied().collect();
    let still_here: Vec<u32> = pids.iter().copied().filter(|p| alive_set.contains(p)).collect();
    if !still_here.is_empty() {
        force_kill(&still_here);
    }
    let alive = detect();
    let alive_set: HashSet<u32> = alive.pids.iter().copied().collect();
    pids.iter().filter(|p| !alive_set.contains(p)).count()
}
