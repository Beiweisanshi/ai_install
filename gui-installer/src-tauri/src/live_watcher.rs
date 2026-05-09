use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::channel;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use tauri::{AppHandle, Emitter};

use crate::channel_config;

/// The minimum gap between "we just wrote" and "an external write happened"
/// for the watcher to forward an event. Anything closer than this to a known
/// self-write is silently swallowed (avoids the apply -> watcher -> apply loop).
const SELF_WRITE_GUARD_MS: i64 = 1500;

static LAST_SELF_WRITE_MS: AtomicI64 = AtomicI64::new(0);
static DEBOUNCER_KEEPALIVE: OnceLock<KeepAlive> = OnceLock::new();

struct KeepAlive {
    _debouncer: Box<dyn std::any::Any + Send + Sync>,
}

pub fn mark_self_write() {
    LAST_SELF_WRITE_MS.store(now_ms(), Ordering::Relaxed);
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn live_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = channel_config::claude_settings_path() {
        out.push(p);
    }
    if let Ok(p) = channel_config::codex_auth_path() {
        out.push(p);
    }
    if let Ok(p) = channel_config::codex_config_path() {
        out.push(p);
    }
    if let Ok(p) = channel_config::gemini_env_path() {
        out.push(p);
    }
    out
}

pub fn setup(app: AppHandle) -> Result<(), String> {
    let paths = live_paths();
    if paths.is_empty() {
        return Err("no live config paths resolvable".to_string());
    }

    let (tx, rx) = channel();
    let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
        .map_err(|e| format!("create debouncer: {e}"))?;

    // Watch each live file's parent directory non-recursively. The file
    // itself may not exist yet (first run), and parent watching means we'll
    // see creation events when cc-switch / installer first writes them.
    let mut watched_dirs: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for path in &paths {
        if let Some(parent) = path.parent() {
            if watched_dirs.insert(parent.to_path_buf()) {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    eprintln!("[live_watcher] mkdir {} failed: {e}", parent.display());
                }
                if let Err(e) = debouncer.watcher().watch(parent, RecursiveMode::NonRecursive) {
                    eprintln!("[live_watcher] watch {} failed: {e}", parent.display());
                }
            }
        }
    }

    // Move the debouncer into a long-lived holder so it isn't dropped (which
    // would stop the underlying inotify/ReadDirectoryChangesW watcher).
    let _ = DEBOUNCER_KEEPALIVE.set(KeepAlive {
        _debouncer: Box::new(debouncer),
    });

    let target_paths: std::collections::HashSet<PathBuf> = paths
        .iter()
        .filter_map(|p| dunce_canonicalize(p).or_else(|| Some(p.clone())))
        .collect();

    thread::spawn(move || {
        loop {
            let events = match rx.recv() {
                Ok(Ok(events)) => events,
                Ok(Err(errors)) => {
                    eprintln!("[live_watcher] notify errors: {errors:?}");
                    continue;
                }
                Err(_) => break, // sender dropped; debouncer gone
            };

            // Filter to events whose canonical path is one of our 4 targets.
            let mut hit = false;
            for ev in events {
                let canon = dunce_canonicalize(&ev.path).unwrap_or(ev.path.clone());
                if target_paths.contains(&canon) {
                    hit = true;
                    break;
                }
            }
            if !hit {
                continue;
            }

            // Self-write guard: skip if we just wrote ourselves.
            let last = LAST_SELF_WRITE_MS.load(Ordering::Relaxed);
            if last > 0 && now_ms() - last < SELF_WRITE_GUARD_MS {
                continue;
            }

            // Re-read live state and emit. Failures are logged, not fatal.
            match channel_config::read_active_settings() {
                Ok(settings) => {
                    if let Err(e) = app.emit("live-config-changed", &settings) {
                        eprintln!("[live_watcher] emit failed: {e}");
                    }
                }
                Err(e) => {
                    eprintln!("[live_watcher] read_active_settings failed: {e}");
                }
            }
        }
    });

    Ok(())
}

fn dunce_canonicalize(p: &std::path::Path) -> Option<PathBuf> {
    // Plain canonicalize fails for non-existent paths; fall back to the input
    // so we still get a stable comparison key. On Windows, std::fs::canonicalize
    // returns extended-length (\\?\) paths — we strip that prefix manually for
    // a fair comparison with our home-relative paths.
    match std::fs::canonicalize(p) {
        Ok(c) => Some(strip_unc_prefix(c)),
        Err(_) => None,
    }
}

fn strip_unc_prefix(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        p
    }
}
