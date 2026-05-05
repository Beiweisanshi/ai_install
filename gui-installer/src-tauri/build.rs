use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let mut attributes = tauri_build::Attributes::new();
    println!("cargo:rerun-if-env-changed=BACKEND_API_BASE_URL");
    println!("cargo:rerun-if-env-changed=VITE_BACKEND_API_BASE_URL");

    let backend_url = env::var("BACKEND_API_BASE_URL")
        .or_else(|_| env::var("VITE_BACKEND_API_BASE_URL"))
        .or_else(|_| vite_env_backend_url())
        .unwrap_or_else(|_| "http://localhost:8080/api/v1".to_string());
    if let Some(host) = backend_host(&backend_url) {
        println!("cargo:rustc-env=BACKEND_HOST={host}");
    }

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
        let icon_source = PathBuf::from("icons").join("icon.ico");
        let icon_copy = out_dir.join("icon.ico");

        println!("cargo:rerun-if-changed={}", icon_source.display());
        fs::copy(&icon_source, &icon_copy).expect("copy icon.ico into OUT_DIR");

        let windows = tauri_build::WindowsAttributes::new().window_icon_path(&icon_copy);
        attributes = attributes.windows_attributes(windows);
    }

    tauri_build::try_build(attributes).expect("failed to run tauri build");
}

fn backend_host(url: &str) -> Option<String> {
    let without_scheme = url.split_once("://")?.1;
    let authority = without_scheme.split('/').next()?.rsplit('@').next()?;
    let authority = authority.trim_matches(['[', ']']);
    let host = authority.split(':').next()?.trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

fn vite_env_backend_url() -> Result<String, env::VarError> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string()));
    let project_root = manifest_dir.parent().unwrap_or(&manifest_dir);
    let mode = env::var("MODE")
        .or_else(|_| env::var("NODE_ENV"))
        .unwrap_or_else(|_| "production".to_string());
    let files = [
        ".env".to_string(),
        ".env.local".to_string(),
        format!(".env.{mode}"),
        format!(".env.{mode}.local"),
    ];

    let mut value = None;
    for file in files {
        let path = project_root.join(file);
        println!("cargo:rerun-if-changed={}", path.display());
        if let Some(next) = read_env_file_value(&path, "VITE_BACKEND_API_BASE_URL") {
            value = Some(next);
        }
    }

    value.ok_or(env::VarError::NotPresent)
}

fn read_env_file_value(path: &Path, key: &str) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    contents.lines().find_map(|line| parse_env_line(line, key))
}

fn parse_env_line(line: &str, key: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
    let (name, raw_value) = line.split_once('=')?;
    if name.trim() != key {
        return None;
    }
    Some(clean_env_value(raw_value))
}

fn clean_env_value(value: &str) -> String {
    let mut value = value.trim().to_string();
    if (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''))
    {
        value = value[1..value.len().saturating_sub(1)].to_string();
    } else if let Some((before_comment, _)) = value.split_once(" #") {
        value = before_comment.trim_end().to_string();
    }
    value
}
