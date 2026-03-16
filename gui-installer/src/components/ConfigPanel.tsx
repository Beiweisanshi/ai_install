import { useMemo, useState } from "react";

import { theme } from "../styles/theme";
import type { ConfigEntry } from "../types";

interface ConfigPanelProps {
  tools: string[];
  onSave: (entries: ConfigEntry[]) => void;
  onSkip: () => void;
}

interface ConfigFormState {
  api_url: string;
  api_key: string;
}

interface FieldErrors {
  api_url?: string;
  api_key?: string;
}

const CONFIGURABLE_TOOLS = ["Claude CLI", "Codex", "Codex CLI", "Gemini", "Gemini CLI"];
const KEY_ONLY_TOOLS: string[] = [];
const SHELL_META_PATTERN = /[;&|`$<>]/;

function needsConfig(toolName: string) {
  return CONFIGURABLE_TOOLS.some((candidate) => toolName.includes(candidate));
}

function validateUrl(url: string) {
  const value = url.trim();

  if (!value) return "请输入 API URL";
  if (value.length > 2048) return "URL 长度不能超过 2048 个字符";

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "URL 必须以 http:// 或 https:// 开头";
    }
  } catch {
    return "请输入有效的 URL";
  }

  return undefined;
}

function validateKey(key: string) {
  const value = key.trim();

  if (!value) return "请输入 API Key";
  if (value.length > 256) return "API Key 长度不能超过 256 个字符";
  if (SHELL_META_PATTERN.test(value)) return "API Key 不能包含 shell 元字符";

  return undefined;
}

function InputField({
  label,
  type = "text",
  placeholder,
  value,
  error,
  onChange,
}: {
  label: string;
  type?: string;
  placeholder: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-medium"
        style={{ color: theme.textSecondary }}
      >
        {label}
      </label>
      <input
        className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors duration-150"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: theme.bgPrimary,
          borderColor: error ? theme.error : theme.border,
          color: theme.textPrimary,
        }}
        type={type}
        value={value}
      />
      {error && (
        <p className="mt-1 text-xs" style={{ color: theme.error }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ConfigPanel({ tools, onSave, onSkip }: ConfigPanelProps) {
  const configurableTools = useMemo(() => tools.filter(needsConfig), [tools]);
  const [form, setForm] = useState<Record<string, ConfigFormState>>(() =>
    Object.fromEntries(
      configurableTools.map((tool) => [tool, { api_url: "", api_key: "" }]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, FieldErrors>>({});

  const updateField = (tool: string, field: keyof ConfigFormState, value: string) => {
    setForm((current) => ({
      ...current,
      [tool]: { ...(current[tool] ?? { api_url: "", api_key: "" }), [field]: value },
    }));
    setErrors((current) => ({
      ...current,
      [tool]: { ...current[tool], [field]: undefined },
    }));
  };

  const handleSave = () => {
    const nextErrors: Record<string, FieldErrors> = {};
    const entries: ConfigEntry[] = configurableTools.map((tool) => {
      const toolForm = form[tool] ?? { api_url: "", api_key: "" };
      const isKeyOnly = KEY_ONLY_TOOLS.includes(tool);
      const apiUrlError = isKeyOnly ? undefined : validateUrl(toolForm.api_url);
      const apiKeyError = validateKey(toolForm.api_key);

      if (apiUrlError || apiKeyError) {
        nextErrors[tool] = { api_key: apiKeyError, api_url: apiUrlError };
      }

      return {
        tool_name: tool,
        api_key: toolForm.api_key.trim(),
        api_url: isKeyOnly ? undefined : toolForm.api_url.trim(),
      };
    });

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSave(entries);
  };

  return (
    <section className="flex h-full flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
          配置 API 凭据
        </h1>
        <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
          为需要凭据的工具填写配置信息
        </p>
      </div>

      {/* Form cards */}
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {configurableTools.length === 0 ? (
          <div
            className="flex items-center justify-center rounded-xl border py-12"
            style={{
              background: theme.bgSecondary,
              borderColor: theme.cardBorder,
              color: theme.textMuted,
            }}
          >
            <p className="text-sm">无需配置的工具，可直接跳过</p>
          </div>
        ) : (
          configurableTools.map((tool) => {
            const toolForm = form[tool] ?? { api_url: "", api_key: "" };
            const toolErrors = errors[tool] ?? {};

            return (
              <div
                className="rounded-xl border p-4"
                key={tool}
                style={{
                  background: theme.bgSecondary,
                  borderColor: theme.cardBorder,
                  boxShadow: theme.cardShadow,
                }}
              >
                <h3
                  className="text-sm font-semibold"
                  style={{ color: theme.textPrimary }}
                >
                  {tool}
                </h3>

                <div className="mt-3 grid gap-3">
                  {!KEY_ONLY_TOOLS.includes(tool) && (
                    <InputField
                      label="API URL"
                      type="url"
                      placeholder="https://api.example.com"
                      value={toolForm.api_url}
                      error={toolErrors.api_url}
                      onChange={(v) => updateField(tool, "api_url", v)}
                    />
                  )}
                  <InputField
                    label="API Key"
                    type="password"
                    placeholder="输入 API Key"
                    value={toolForm.api_key}
                    error={toolErrors.api_key}
                    onChange={(v) => updateField(tool, "api_key", v)}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          className="rounded-full px-5 py-2 text-sm font-medium transition-colors duration-150"
          onClick={onSkip}
          style={{ color: theme.textSecondary }}
          type="button"
        >
          跳过
        </button>
        <button
          className="rounded-full px-6 py-2.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px"
          onClick={handleSave}
          style={{
            background: theme.accent,
            color: theme.textOnAccent,
            boxShadow: "0 2px 8px rgba(196,112,75,0.3)",
          }}
          type="button"
        >
          保存配置
        </button>
      </div>
    </section>
  );
}

export default ConfigPanel;
