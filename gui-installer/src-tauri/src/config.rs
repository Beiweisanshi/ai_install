use crate::types::{ConfigEntry, InstallerError};

#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::path::PathBuf;

#[cfg(target_os = "windows")]
use crate::installer::windows::hidden_command;

#[cfg(target_os = "macos")]
const MANAGED_BLOCK_MARKER: &str = "# --- AI Tools Installer managed ---";

pub fn validate_config_entry(entry: &ConfigEntry) -> Result<(), InstallerError> {
    let is_key_only = matches!(entry.tool_name.as_str(), "Gemini" | "Gemini CLI");

    if !is_key_only {
        let api_url = entry
            .api_url
            .as_deref()
            .ok_or_else(|| InstallerError::InvalidInput {
                detail: format!("missing api_url for {}", entry.tool_name),
                user_message: "Invalid configuration input".to_string(),
            })?;

        if api_url.is_empty() {
            return Err(InstallerError::InvalidInput {
                detail: format!("api_url is empty for {}", entry.tool_name),
                user_message: "Invalid configuration input".to_string(),
            });
        }

        validate_url(api_url).map_err(|error| InstallerError::InvalidInput {
            detail: format!("{} for {}", error.detail(), entry.tool_name),
            user_message: "Invalid configuration input".to_string(),
        })?;
    }

    let api_key = entry
        .api_key
        .as_deref()
        .ok_or_else(|| InstallerError::InvalidInput {
            detail: format!("missing api_key for {}", entry.tool_name),
            user_message: "Invalid configuration input".to_string(),
        })?;

    validate_key(api_key).map_err(|error| InstallerError::InvalidInput {
        detail: format!("{} for {}", error.detail(), entry.tool_name),
        user_message: "Invalid configuration input".to_string(),
    })?;

    Ok(())
}

fn validate_url(api_url: &str) -> Result<(), InstallerError> {
    if api_url.is_empty() {
        return Ok(());
    }

    if api_url.chars().count() > 2048 {
        return Err(InstallerError::InvalidInput {
            detail: "api_url exceeds 2048 characters".to_string(),
            user_message: "Invalid configuration input".to_string(),
        });
    }

    if !(api_url.starts_with("http://") || api_url.starts_with("https://")) {
        return Err(InstallerError::InvalidInput {
            detail: "api_url must start with http:// or https://".to_string(),
            user_message: "Invalid configuration input".to_string(),
        });
    }

    if api_url.chars().any(char::is_whitespace) {
        return Err(InstallerError::InvalidInput {
            detail: "api_url contains whitespace".to_string(),
            user_message: "Invalid configuration input".to_string(),
        });
    }

    Ok(())
}

fn validate_key(api_key: &str) -> Result<(), InstallerError> {
    if api_key.trim().is_empty() {
        return Err(InstallerError::InvalidInput {
            detail: "api_key is empty".to_string(),
            user_message: "Invalid configuration input".to_string(),
        });
    }

    if api_key.chars().count() > 256 {
        return Err(InstallerError::InvalidInput {
            detail: "api_key exceeds 256 characters".to_string(),
            user_message: "Invalid configuration input".to_string(),
        });
    }

    if api_key.chars().any(is_forbidden_api_key_char) {
        return Err(InstallerError::InvalidInput {
            detail: "api_key contains forbidden shell metacharacters".to_string(),
            user_message: "Invalid configuration input".to_string(),
        });
    }

    Ok(())
}

pub fn save_all_configs(entries: Vec<ConfigEntry>) -> Result<(), InstallerError> {
    for entry in entries {
        validate_config_entry(&entry)?;

        match entry.tool_name.as_str() {
            "Claude CLI" => {
                let api_key = required_field(&entry.api_key, "api_key", &entry.tool_name)?;
                let api_url = required_field(&entry.api_url, "api_url", &entry.tool_name)?;
                save_env_config("ANTHROPIC_API_KEY", api_key)?;
                save_env_config("ANTHROPIC_BASE_URL", api_url)?;
            }
            "Codex" | "Codex CLI" => {
                let api_key = required_field(&entry.api_key, "api_key", &entry.tool_name)?;
                let api_url = required_field(&entry.api_url, "api_url", &entry.tool_name)?;
                save_env_config("OPENAI_API_KEY", api_key)?;
                save_env_config("OPENAI_BASE_URL", api_url)?;
            }
            "Gemini" | "Gemini CLI" => {
                let api_key = required_field(&entry.api_key, "api_key", &entry.tool_name)?;
                save_env_config("GEMINI_API_KEY", api_key)?;
            }
            other => {
                return Err(InstallerError::InvalidInput {
                    detail: format!("unsupported config tool: {other}"),
                    user_message: "Invalid configuration input".to_string(),
                });
            }
        }
    }

    Ok(())
}

pub fn save_env_config(var_name: &str, value: &str) -> Result<(), InstallerError> {
    #[cfg(target_os = "windows")]
    {
        let status = hidden_command("setx")
            .arg(var_name)
            .arg(value)
            .status()
            .map_err(|error| InstallerError::ConfigFailed {
                detail: format!("failed to execute setx for {var_name}: {error}"),
                user_message: "Failed to save configuration".to_string(),
            })?;

        if !status.success() {
            return Err(InstallerError::ConfigFailed {
                detail: format!("setx returned non-zero exit status for {var_name}: {status}"),
                user_message: "Failed to save configuration".to_string(),
            });
        }

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let profile_path = shell_profile_path()?;
        let content = if profile_path.exists() {
            fs::read_to_string(&profile_path).map_err(|error| InstallerError::ConfigFailed {
                detail: format!(
                    "failed to read shell profile {}: {error}",
                    profile_path.display()
                ),
                user_message: "Failed to save configuration".to_string(),
            })?
        } else {
            String::new()
        };

        let updated = upsert_managed_export(&content, var_name, value);
        fs::write(&profile_path, updated).map_err(|error| InstallerError::ConfigFailed {
            detail: format!(
                "failed to write shell profile {}: {error}",
                profile_path.display()
            ),
            user_message: "Failed to save configuration".to_string(),
        })?;
        set_macos_private_permissions(&profile_path)?;

        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (var_name, value);
        Err(InstallerError::ConfigFailed {
            detail: "environment config is only supported on Windows and macOS".to_string(),
            user_message: "Failed to save configuration".to_string(),
        })
    }
}

fn required_field<'a>(
    value: &'a Option<String>,
    field_name: &str,
    tool_name: &str,
) -> Result<&'a str, InstallerError> {
    value
        .as_deref()
        .ok_or_else(|| InstallerError::InvalidInput {
            detail: format!("missing {field_name} for {tool_name}"),
            user_message: "Invalid configuration input".to_string(),
        })
}

fn is_forbidden_api_key_char(ch: char) -> bool {
    matches!(
        ch,
        '\'' | '"' | '`' | ';' | '|' | '&' | '$' | '(' | ')' | '>' | '<' | '\\' | '\n' | '\r'
    )
}

#[cfg(test)]
mod tests {
    use super::{is_forbidden_api_key_char, validate_key, validate_url};

    #[test]
    fn test_validate_url() {
        assert!(validate_url("http://ok").is_ok());
        assert!(validate_url("https://ok").is_ok());
        assert!(validate_url("ftp://bad").is_err());
        assert!(validate_url("").is_ok());
        assert!(validate_url(&format!("https://{}", "a".repeat(2041))).is_err());
    }

    #[test]
    fn test_validate_key() {
        assert!(validate_key("normal-key_123").is_ok());
        assert!(validate_key("").is_err());
        assert!(validate_key("bad;key").is_err());
        assert!(validate_key(&"k".repeat(257)).is_err());
    }

    #[test]
    fn test_forbidden_chars() {
        for ch in ['\'', '"', ';', '|', '&', '$', '`', '(', ')', '>', '<', '\\'] {
            assert!(
                is_forbidden_api_key_char(ch),
                "expected {ch:?} to be forbidden"
            );
        }
    }
}


#[cfg(target_os = "macos")]
fn shell_profile_path() -> Result<PathBuf, InstallerError> {
    let home = home_dir()?;
    let zshrc = home.join(".zshrc");
    if zshrc.exists() {
        return Ok(zshrc);
    }

    let bashrc = home.join(".bashrc");
    if bashrc.exists() {
        return Ok(bashrc);
    }

    Ok(zshrc)
}

#[cfg(target_os = "macos")]
fn home_dir() -> Result<PathBuf, InstallerError> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| InstallerError::ConfigFailed {
            detail: "HOME is not set".to_string(),
            user_message: "Failed to save configuration".to_string(),
        })
}

#[cfg(target_os = "macos")]
fn upsert_managed_export(content: &str, var_name: &str, value: &str) -> String {
    let lines: Vec<String> = content.lines().map(str::to_string).collect();
    let marker_positions: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| (line == MANAGED_BLOCK_MARKER).then_some(index))
        .collect();

    let (prefix, managed, suffix) = if marker_positions.len() >= 2 {
        (
            lines[..marker_positions[0]].to_vec(),
            lines[marker_positions[0] + 1..marker_positions[1]].to_vec(),
            lines[marker_positions[1] + 1..].to_vec(),
        )
    } else if marker_positions.len() == 1 {
        (
            lines[..marker_positions[0]].to_vec(),
            lines[marker_positions[0] + 1..].to_vec(),
            Vec::new(),
        )
    } else {
        (lines, Vec::new(), Vec::new())
    };

    let export_prefix = format!("export {var_name}=");
    let replacement = format!("export {var_name}={}", shell_single_quoted(value));
    let mut updated_managed = Vec::with_capacity(managed.len().saturating_add(1));
    let mut replaced = false;

    for line in managed {
        if line.starts_with(&export_prefix) {
            if !replaced {
                updated_managed.push(replacement.clone());
                replaced = true;
            }
        } else if !line.trim().is_empty() {
            updated_managed.push(line);
        }
    }

    if !replaced {
        updated_managed.push(replacement);
    }

    let mut output = Vec::new();
    if !prefix.is_empty() {
        output.extend(prefix);
        if !output.last().is_some_and(|line: &String| line.is_empty()) {
            output.push(String::new());
        }
    }

    output.push(MANAGED_BLOCK_MARKER.to_string());
    output.extend(updated_managed);
    output.push(MANAGED_BLOCK_MARKER.to_string());

    if !suffix.is_empty() {
        if !suffix.first().is_some_and(|line| line.is_empty()) {
            output.push(String::new());
        }
        output.extend(suffix);
    }

    if output.is_empty() {
        format!("{MANAGED_BLOCK_MARKER}\n{MANAGED_BLOCK_MARKER}\n")
    } else {
        format!("{}\n", output.join("\n"))
    }
}

#[cfg(target_os = "macos")]
fn shell_single_quoted(value: &str) -> String {
    let escaped = value.replace('\'', "'\\''");
    format!("'{escaped}'")
}

#[cfg(target_os = "macos")]
fn set_macos_private_permissions(path: &PathBuf) -> Result<(), InstallerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|error| InstallerError::ConfigFailed {
        detail: format!("failed to chmod 600 {}: {error}", path.display()),
        user_message: "Failed to save configuration".to_string(),
    })
}
