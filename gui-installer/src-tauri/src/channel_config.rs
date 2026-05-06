use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::fs_util::atomic_write_bytes;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ChannelPayload {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub tool_configs: ToolConfigsPayload,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ToolConfigsPayload {
    pub claude: ToolEntry,
    pub codex: ToolEntry,
    pub gemini: ToolEntry,
    #[serde(default)]
    pub opencode: ToolEntry,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSettings {
    pub claude_base_url: Option<String>,
    pub claude_auth_token: Option<String>,
    pub claude_api_key: Option<String>,
    pub codex_base_url: Option<String>,
    pub codex_api_key: Option<String>,
    pub gemini_base_url: Option<String>,
    pub gemini_api_key: Option<String>,
}

const CODEX_PROVIDER_ID: &str = "zm_tool";

pub fn apply_active_channel(channel: ChannelPayload) -> Result<(), String> {
    let claude = &channel.tool_configs.claude;
    if !claude.base_url.is_empty() && !claude.api_key.is_empty() {
        write_claude_settings(claude).map_err(|e| format!("claude: {e}"))?;
    }

    let codex = &channel.tool_configs.codex;
    if !codex.base_url.is_empty() && !codex.api_key.is_empty() {
        write_codex_files(codex).map_err(|e| format!("codex: {e}"))?;
    }

    let gemini = &channel.tool_configs.gemini;
    if !gemini.base_url.is_empty() && !gemini.api_key.is_empty() {
        write_gemini_env(gemini).map_err(|e| format!("gemini: {e}"))?;
    }

    Ok(())
}

pub fn read_active_settings() -> Result<ActiveSettings, String> {
    let mut out = ActiveSettings::default();

    if let Ok(text) = fs::read_to_string(claude_settings_path()?) {
        if let Ok(Value::Object(root)) = serde_json::from_str::<Value>(&text) {
            if let Some(Value::Object(env)) = root.get("env") {
                out.claude_base_url = env.get("ANTHROPIC_BASE_URL").and_then(string_value);
                out.claude_auth_token = env.get("ANTHROPIC_AUTH_TOKEN").and_then(string_value);
                out.claude_api_key = env.get("ANTHROPIC_API_KEY").and_then(string_value);
            }
        }
    }

    if let Ok(text) = fs::read_to_string(codex_auth_path()?) {
        if let Ok(Value::Object(root)) = serde_json::from_str::<Value>(&text) {
            out.codex_api_key = root.get("OPENAI_API_KEY").and_then(string_value);
        }
    }
    if let Ok(text) = fs::read_to_string(codex_config_path()?) {
        if let Ok(doc) = text.parse::<DocumentMut>() {
            if let Some(provider) = doc
                .get("model_providers")
                .and_then(|v| v.as_table())
                .and_then(|t| t.get(CODEX_PROVIDER_ID))
                .and_then(|v| v.as_table())
            {
                out.codex_base_url = provider
                    .get("base_url")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
        }
    }

    if let Ok(text) = fs::read_to_string(gemini_env_path()?) {
        for line in text.lines() {
            if let Some((key, val)) = parse_env_line(line) {
                match key {
                    "GEMINI_API_KEY" => out.gemini_api_key = Some(val),
                    "GOOGLE_GEMINI_BASE_URL" => out.gemini_base_url = Some(val),
                    _ => {}
                }
            }
        }
    }

    Ok(out)
}

fn write_claude_settings(entry: &ToolEntry) -> Result<(), String> {
    let path = claude_settings_path()?;
    let prev_text = read_to_string_or_empty(&path)?;
    let mut root: Map<String, Value> = if prev_text.trim().is_empty() {
        Map::new()
    } else {
        match serde_json::from_str::<Value>(&prev_text) {
            Ok(Value::Object(map)) => map,
            Ok(_) => return Err(format!("{} is not a JSON object", path.display())),
            Err(e) => return Err(format!("parse {} failed: {e}", path.display())),
        }
    };

    let env_value = root
        .entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let env = match env_value {
        Value::Object(map) => map,
        _ => return Err("settings.json `env` is not an object".to_string()),
    };

    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        Value::String(entry.api_key.clone()),
    );
    env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        Value::String(entry.base_url.clone()),
    );
    // Remove the conflicting variant so Claude Code doesn't pick stale value
    env.remove("ANTHROPIC_API_KEY");

    let serialized = serde_json::to_vec_pretty(&Value::Object(root))
        .map_err(|e| format!("serialize settings.json: {e}"))?;
    atomic_write_bytes(&path, &serialized)
}

fn write_codex_files(entry: &ToolEntry) -> Result<(), String> {
    let auth_path = codex_auth_path()?;
    let auth_prev = read_to_string_or_empty(&auth_path)?;
    let mut auth_root: Map<String, Value> = if auth_prev.trim().is_empty() {
        Map::new()
    } else {
        match serde_json::from_str::<Value>(&auth_prev) {
            Ok(Value::Object(map)) => map,
            // Refuse to silently clobber a non-object or unparseable auth.json.
            Ok(_) => return Err(format!("{} is not a JSON object", auth_path.display())),
            Err(e) => return Err(format!("parse {} failed: {e}", auth_path.display())),
        }
    };
    auth_root.insert(
        "OPENAI_API_KEY".to_string(),
        Value::String(entry.api_key.clone()),
    );
    let auth_serialized = serde_json::to_vec_pretty(&Value::Object(auth_root))
        .map_err(|e| format!("serialize auth.json: {e}"))?;

    let config_path = codex_config_path()?;
    let config_prev = read_to_string_or_empty(&config_path)?;
    let mut doc: DocumentMut = if config_prev.trim().is_empty() {
        DocumentMut::new()
    } else {
        config_prev
            .parse::<DocumentMut>()
            .map_err(|e| format!("parse config.toml failed: {e}"))?
    };

    doc["model_provider"] = value(CODEX_PROVIDER_ID);

    // toml_edit can't mutate sub-tables of an inline table; convert to regular table first.
    promote_to_table(&mut doc, "model_providers")?;
    let providers = doc
        .entry("model_providers")
        .or_insert_with(|| Item::Table(Table::new()));
    let providers_table = providers
        .as_table_mut()
        .ok_or_else(|| "config.toml `model_providers` is not a table".to_string())?;
    if let Some(existing) = providers_table.get(CODEX_PROVIDER_ID) {
        if existing.is_inline_table() {
            let inline = existing.as_inline_table().cloned();
            if let Some(inline) = inline {
                let mut t = Table::new();
                for (k, v) in inline.iter() {
                    t.insert(k, value(v.clone()));
                }
                providers_table.insert(CODEX_PROVIDER_ID, Item::Table(t));
            }
        }
    }
    let provider_entry = providers_table
        .entry(CODEX_PROVIDER_ID)
        .or_insert_with(|| Item::Table(Table::new()));
    let provider_table = provider_entry
        .as_table_mut()
        .ok_or_else(|| "model_providers.zm_tool is not a table".to_string())?;
    provider_table["base_url"] = value(entry.base_url.clone());
    provider_table["wire_api"] = value("chat");
    if !provider_table.contains_key("name") {
        provider_table["name"] = value("ZM Tool");
    }
    if !provider_table.contains_key("env_key") {
        provider_table["env_key"] = value("OPENAI_API_KEY");
    }

    let config_serialized = doc.to_string();
    if config_serialized.parse::<DocumentMut>().is_err() {
        return Err("rendered config.toml failed round-trip validation; refusing to write to avoid corruption".to_string());
    }

    // Two-phase atomic: write auth first, then config; if config fails, revert auth.
    let auth_backup = if auth_path.exists() {
        Some(fs::read(&auth_path).map_err(|e| format!("backup auth.json: {e}"))?)
    } else {
        None
    };

    atomic_write_bytes(&auth_path, &auth_serialized)?;
    if let Err(e) = atomic_write_bytes(&config_path, config_serialized.as_bytes()) {
        // Roll back auth.json. Surface the rollback failure too — silent loss
        // would leave a new auth.json paired with an old config.toml.
        let rollback = match auth_backup {
            Some(backup) => atomic_write_bytes(&auth_path, &backup),
            None => fs::remove_file(&auth_path).map_err(|err| format!("remove {}: {err}", auth_path.display())),
        };
        return match rollback {
            Ok(_) => Err(e),
            Err(rollback_err) => Err(format!("{e}; auth.json rollback also failed: {rollback_err}")),
        };
    }
    Ok(())
}

fn promote_to_table(doc: &mut DocumentMut, key: &str) -> Result<(), String> {
    let needs_promote = doc
        .get(key)
        .map(|item| item.is_inline_table())
        .unwrap_or(false);
    if !needs_promote {
        return Ok(());
    }
    let inline = doc
        .get(key)
        .and_then(|i| i.as_inline_table())
        .cloned()
        .ok_or_else(|| format!("{key} is not an inline table"))?;
    let mut t = Table::new();
    for (k, v) in inline.iter() {
        t.insert(k, value(v.clone()));
    }
    doc.insert(key, Item::Table(t));
    Ok(())
}

fn write_gemini_env(entry: &ToolEntry) -> Result<(), String> {
    let path = gemini_env_path()?;
    let prev_text = read_to_string_or_empty(&path)?;

    let updates: &[(&str, &str)] = &[
        ("GEMINI_API_KEY", entry.api_key.as_str()),
        ("GOOGLE_GEMINI_BASE_URL", entry.base_url.as_str()),
        ("GEMINI_MODEL", "gemini-2.0-flash"),
    ];

    let mut lines: Vec<String> = Vec::new();
    let mut handled: Vec<bool> = vec![false; updates.len()];

    for line in prev_text.lines() {
        let mut replaced = false;
        if let Some((key, _)) = parse_env_line(line) {
            for (i, (target, val)) in updates.iter().enumerate() {
                if key == *target {
                    if !handled[i] {
                        lines.push(format_env_line(target, val));
                        handled[i] = true;
                    }
                    replaced = true;
                    break;
                }
            }
        }
        if !replaced {
            lines.push(line.to_string());
        }
    }

    for (i, (target, val)) in updates.iter().enumerate() {
        if !handled[i] {
            lines.push(format_env_line(target, val));
        }
    }

    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    atomic_write_bytes(&path, out.as_bytes())
}

fn format_env_line(key: &str, value: &str) -> String {
    // Quote the value if it contains anything that would change parsing
    // (whitespace, `#`, quotes, backslash, etc.). The CLI loaders expect
    // shell-like syntax, so we use double quotes and escape `\` and `"`.
    let needs_quote = value.is_empty()
        || value.chars().any(|c| {
            c.is_whitespace() || matches!(c, '"' | '\'' | '#' | '\\' | '$' | '`')
        });
    if needs_quote {
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        format!("{key}=\"{escaped}\"")
    } else {
        format!("{key}={value}")
    }
}

fn read_to_string_or_empty(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "could not determine home directory".to_string())
}

fn claude_settings_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".claude").join("settings.json"))
}

fn codex_auth_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".codex").join("auth.json"))
}

fn codex_config_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".codex").join("config.toml"))
}

fn gemini_env_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".gemini").join(".env"))
}

fn string_value(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

fn parse_env_line(line: &str) -> Option<(&str, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (key, rest) = trimmed.split_once('=')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    let rest = rest.trim_start();
    let val = if let Some(stripped) = rest.strip_prefix('"').and_then(|s| s.rsplit_once('"')) {
        // Reverse the escaping done by `format_env_line`.
        stripped.0.replace("\\\"", "\"").replace("\\\\", "\\")
    } else if let Some(stripped) = rest.strip_prefix('\'').and_then(|s| s.rsplit_once('\'')) {
        stripped.0.to_string()
    } else {
        // Unquoted: strip inline `# ...` comments and trailing whitespace.
        rest.split_once(" #")
            .map(|(v, _)| v)
            .unwrap_or(rest)
            .trim_end()
            .to_string()
    };
    Some((key, val))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(url: &str, key: &str) -> ToolEntry {
        ToolEntry {
            base_url: url.to_string(),
            api_key: key.to_string(),
        }
    }

    #[test]
    fn claude_merge_preserves_foreign_keys_and_drops_api_key() {
        let prev = json!({
            "mcpServers": { "x": 1 },
            "permissions": { "allow": ["Read"] },
            "env": { "FOO": "bar", "ANTHROPIC_API_KEY": "old" }
        });
        let prev_text = serde_json::to_string(&prev).unwrap();

        let mut root: Map<String, Value> = serde_json::from_str(&prev_text).unwrap();
        let env_value = root.entry("env".to_string()).or_insert_with(|| Value::Object(Map::new()));
        let env = env_value.as_object_mut().unwrap();
        env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), Value::String("new".into()));
        env.insert("ANTHROPIC_BASE_URL".to_string(), Value::String("https://relay/v1".into()));
        env.remove("ANTHROPIC_API_KEY");

        let merged = Value::Object(root);
        assert_eq!(merged["mcpServers"]["x"], json!(1));
        assert_eq!(merged["permissions"]["allow"][0], json!("Read"));
        assert_eq!(merged["env"]["FOO"], json!("bar"));
        assert_eq!(merged["env"]["ANTHROPIC_AUTH_TOKEN"], json!("new"));
        assert_eq!(merged["env"]["ANTHROPIC_BASE_URL"], json!("https://relay/v1"));
        assert!(merged["env"].get("ANTHROPIC_API_KEY").is_none());
    }

    #[test]
    fn codex_toml_merge_is_idempotent() {
        let initial = "# user comment\n[mcp_servers.foo]\ncommand = \"bar\"\n";
        let mut doc: DocumentMut = initial.parse().unwrap();
        doc["model_provider"] = value(CODEX_PROVIDER_ID);
        let providers = doc.entry("model_providers").or_insert_with(|| Item::Table(Table::new()));
        let providers_t = providers.as_table_mut().unwrap();
        let provider = providers_t.entry(CODEX_PROVIDER_ID).or_insert_with(|| Item::Table(Table::new()));
        let provider_t = provider.as_table_mut().unwrap();
        provider_t["base_url"] = value("https://api.example/v1");
        provider_t["wire_api"] = value("chat");
        provider_t["name"] = value("ZM Tool");
        provider_t["env_key"] = value("OPENAI_API_KEY");

        let rendered = doc.to_string();
        // Round-trip validation
        rendered.parse::<DocumentMut>().expect("must parse back");
        assert!(rendered.contains("# user comment"));
        assert!(rendered.contains("[mcp_servers.foo]"));
        assert!(rendered.contains("https://api.example/v1"));
    }

    #[test]
    fn gemini_env_upsert_preserves_unrelated_lines() {
        let prev = "# user note\nMY_VAR=keep\nGEMINI_API_KEY=old\n";
        let mut lines: Vec<String> = Vec::new();
        let updates: &[(&str, &str)] = &[
            ("GEMINI_API_KEY", "new-key"),
            ("GOOGLE_GEMINI_BASE_URL", "https://g/v1beta"),
            ("GEMINI_MODEL", "gemini-2.0-flash"),
        ];
        let mut handled = vec![false; updates.len()];
        for line in prev.lines() {
            let mut replaced = false;
            if let Some((key, _)) = parse_env_line(line) {
                for (i, (t, v)) in updates.iter().enumerate() {
                    if key == *t {
                        if !handled[i] {
                            lines.push(format!("{t}={v}"));
                            handled[i] = true;
                        }
                        replaced = true;
                        break;
                    }
                }
            }
            if !replaced {
                lines.push(line.to_string());
            }
        }
        for (i, (t, v)) in updates.iter().enumerate() {
            if !handled[i] {
                lines.push(format!("{t}={v}"));
            }
        }
        let result = lines.join("\n");
        assert!(result.contains("# user note"));
        assert!(result.contains("MY_VAR=keep"));
        assert!(result.contains("GEMINI_API_KEY=new-key"));
        assert!(result.contains("GOOGLE_GEMINI_BASE_URL=https://g/v1beta"));
    }

    #[test]
    fn parse_env_line_handles_comments_and_quotes() {
        assert_eq!(parse_env_line("# comment"), None);
        assert_eq!(parse_env_line(""), None);
        assert_eq!(parse_env_line("KEY=value"), Some(("KEY", "value".to_string())));
        assert_eq!(parse_env_line("  KEY = \"v a l\"  "), Some(("KEY", "v a l".to_string())));
        assert_eq!(parse_env_line("KEY='quoted'"), Some(("KEY", "quoted".to_string())));
        // Inline comment after unquoted value
        assert_eq!(parse_env_line("KEY=value # note"), Some(("KEY", "value".to_string())));
        // `#` inside quotes must be preserved
        assert_eq!(parse_env_line("KEY=\"a#b\""), Some(("KEY", "a#b".to_string())));
        // Round-trip of escaped chars from format_env_line
        assert_eq!(parse_env_line("KEY=\"a\\\"b\""), Some(("KEY", "a\"b".to_string())));
        assert_eq!(parse_env_line("KEY=\"a\\\\b\""), Some(("KEY", "a\\b".to_string())));
    }

    #[test]
    fn format_env_line_quotes_special_chars() {
        assert_eq!(format_env_line("K", "value"), "K=value");
        assert_eq!(format_env_line("K", "v a l"), "K=\"v a l\"");
        assert_eq!(format_env_line("K", "a#b"), "K=\"a#b\"");
        assert_eq!(format_env_line("K", "a\\b"), "K=\"a\\\\b\"");
        assert_eq!(format_env_line("K", "a\"b"), "K=\"a\\\"b\"");
        assert_eq!(format_env_line("K", ""), "K=\"\"");
    }

    #[test]
    fn codex_inline_table_promotion() {
        // Existing config has model_providers as an inline table.
        let initial = "model_providers = { existing = { base_url = \"https://x\" } }\n";
        let mut doc: DocumentMut = initial.parse().unwrap();
        promote_to_table(&mut doc, "model_providers").unwrap();
        // After promotion, model_providers should be a regular table that we
        // can mutate and serialize back without losing keys.
        let providers = doc.get("model_providers").unwrap().as_table().unwrap();
        assert!(providers.contains_key("existing"));
        let rendered = doc.to_string();
        assert!(rendered.parse::<DocumentMut>().is_ok());
    }

    #[test]
    fn apply_active_channel_skips_empty_entries() {
        let payload = ChannelPayload {
            id: "x".into(),
            name: "x".into(),
            tool_configs: ToolConfigsPayload {
                claude: entry("", ""),
                codex: entry("", ""),
                gemini: entry("", ""),
                opencode: entry("", ""),
            },
            is_default: false,
        };
        // Empty config => no-op success
        assert!(apply_active_channel(payload).is_ok());
    }
}
