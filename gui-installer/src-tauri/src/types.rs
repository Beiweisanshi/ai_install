use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ToolInfo {
    pub name: &'static str,
    pub cmd: &'static str,
    pub version_args: &'static [&'static str],
    pub npm_pkg: Option<&'static str>,
    pub group: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectResult {
    pub name: String,
    pub installed: bool,
    pub current_version: Option<String>,
    pub available_version: Option<String>,
    pub upgradable: bool,
    pub installable: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
    pub name: String,
    pub success: bool,
    pub version: Option<String>,
    pub message: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppVersionInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub upgrade_available: bool,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub tool_name: String,
    pub stage: String,
    pub percent: u8,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfigEntry {
    pub tool_name: String,
    pub api_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone)]
pub enum InstallerError {
    PackageNotFound {
        detail: String,
        user_message: String,
    },
    InstallFailed {
        detail: String,
        user_message: String,
    },
    DetectFailed {
        detail: String,
        user_message: String,
    },
    ConfigFailed {
        detail: String,
        user_message: String,
    },
    Timeout {
        detail: String,
        user_message: String,
    },
    HashMismatch {
        detail: String,
        user_message: String,
    },
    InvalidInput {
        detail: String,
        user_message: String,
    },
}

impl InstallerError {
    pub fn detail(&self) -> &str {
        match self {
            Self::PackageNotFound { detail, .. }
            | Self::InstallFailed { detail, .. }
            | Self::DetectFailed { detail, .. }
            | Self::ConfigFailed { detail, .. }
            | Self::Timeout { detail, .. }
            | Self::HashMismatch { detail, .. }
            | Self::InvalidInput { detail, .. } => detail,
        }
    }

    pub fn user_message(&self) -> &str {
        match self {
            Self::PackageNotFound { user_message, .. }
            | Self::InstallFailed { user_message, .. }
            | Self::DetectFailed { user_message, .. }
            | Self::ConfigFailed { user_message, .. }
            | Self::Timeout { user_message, .. }
            | Self::HashMismatch { user_message, .. }
            | Self::InvalidInput { user_message, .. } => user_message,
        }
    }
}

impl fmt::Display for InstallerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.user_message())
    }
}

impl std::error::Error for InstallerError {}

impl From<InstallerError> for String {
    fn from(value: InstallerError) -> Self {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::InstallerError;

    #[test]
    fn test_installer_error_display() {
        let error = InstallerError::InstallFailed {
            detail: "internal detail".to_string(),
            user_message: "User facing message".to_string(),
        };

        let displayed = error.to_string();
        assert_eq!(displayed, "User facing message");
        assert!(!displayed.contains("internal detail"));
    }

    #[test]
    fn test_installer_error_to_string() {
        let error = InstallerError::InvalidInput {
            detail: "hidden detail".to_string(),
            user_message: "Converted message".to_string(),
        };

        let value: String = error.into();
        assert_eq!(value, "Converted message");
    }
}

pub const TOOLS: [ToolInfo; 7] = [
    ToolInfo {
        name: "Nushell",
        cmd: "nu",
        version_args: &["--version"],
        npm_pkg: None,
        group: "runtime",
    },
    ToolInfo {
        name: "Git",
        cmd: "git",
        version_args: &["--version"],
        npm_pkg: None,
        group: "vcs",
    },
    ToolInfo {
        name: "Node.js",
        cmd: "node",
        version_args: &["--version"],
        npm_pkg: None,
        group: "runtime",
    },
    ToolInfo {
        name: "Claude CLI",
        cmd: "claude",
        version_args: &["--version"],
        npm_pkg: Some("@anthropic-ai/claude-code"),
        group: "npm",
    },
    ToolInfo {
        name: "Codex CLI",
        cmd: "codex",
        version_args: &["--version"],
        npm_pkg: Some("@openai/codex"),
        group: "npm",
    },
    ToolInfo {
        name: "Gemini CLI",
        cmd: "gemini",
        version_args: &["--version"],
        npm_pkg: Some("@google/gemini-cli"),
        group: "npm",
    },
    ToolInfo {
        name: "CC-Switch",
        cmd: "cc-switch",
        version_args: &["--version"],
        npm_pkg: None,
        group: "tool",
    },
];
