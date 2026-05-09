use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::channel;
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, Debouncer};
use tauri::{AppHandle, Emitter};

use crate::channel_config;

/// Suppress watcher events that fire within this window after our own apply.
/// Prevents the apply -> watcher -> apply self-loop without losing real
/// external writes that happen later.
const SELF_WRITE_GUARD_MS: u64 = 1500;

static MONOTONIC_START: OnceLock<Instant> = OnceLock::new();
static LAST_SELF_WRITE_MS: AtomicU64 = AtomicU64::new(0);
static DEBOUNCER_KEEPALIVE: OnceLock<Debouncer<RecommendedWatcher>> = OnceLock::new();

pub fn mark_self_write() {
    LAST_SELF_WRITE_MS.store(now_ms(), Ordering::Relaxed);
}

fn now_ms() -> u64 {
    let start = MONOTONIC_START.get_or_init(Instant::now);
    Instant::now().duration_since(*start).as_millis() as u64
}

pub fn setup(app: AppHandle) -> Result<(), String> {
    let _ = MONOTONIC_START.get_or_init(Instant::now);

    let paths = channel_config::live_paths();
    if paths.is_empty() {
        return Err("no live config paths resolvable".to_string());
    }

    let (tx, rx) = channel();
    let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
        .map_err(|e| format!("create debouncer: {e}"))?;

    // Watch each live file's parent directory non-recursively — the file
    // itself may not exist yet on first run.
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

    // Hold the debouncer for the lifetime of the process — dropping it would
    // stop the underlying inotify/ReadDirectoryChangesW watcher.
    let _ = DEBOUNCER_KEEPALIVE.set(debouncer);

    // Canonicalize the target paths once so per-event comparison is cheap and
    // doesn't hit the filesystem.
    let target_paths: std::collections::HashSet<PathBuf> = paths
        .iter()
        .map(|p| canonicalize_or_self(p))
        .collect();

    thread::spawn(move || {
        loop {
            let events = match rx.recv() {
                Ok(Ok(events)) => events,
                Ok(Err(errors)) => {
                    eprintln!("[live_watcher] notify errors: {errors:?}");
                    continue;
                }
                Err(_) => break,
            };

            let hit = events.iter().any(|ev| {
                let canon = canonicalize_or_self(&ev.path);
                target_paths.contains(&canon)
            });
            if !hit {
                continue;
            }

            let last = LAST_SELF_WRITE_MS.load(Ordering::Relaxed);
            if last > 0 && now_ms().saturating_sub(last) < SELF_WRITE_GUARD_MS {
                continue;
            }

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

fn canonicalize_or_self(p: &std::path::Path) -> PathBuf {
    // std::fs::canonicalize fails for non-existent paths — fall back to the
    // input. On Windows, canonicalize returns extended-length (\\?\) paths;
    // strip that prefix so comparisons against home-relative paths line up.
    match std::fs::canonicalize(p) {
        Ok(c) => strip_unc_prefix(c),
        Err(_) => p.to_path_buf(),
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
