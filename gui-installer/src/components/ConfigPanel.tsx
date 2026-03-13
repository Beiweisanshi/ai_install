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

const CONFIGURABLE_TOOLS = ["CC-Switch", "Codex", "Codex CLI", "Gemini", "Gemini CLI"];
const KEY_ONLY_TOOLS = ["Gemini", "Gemini CLI"];
const SHELL_META_PATTERN = /[;&|`$<>]/;

function needsConfig(toolName: string) {
  return CONFIGURABLE_TOOLS.some((candidate) => toolName.includes(candidate));
}

function validateUrl(url: string) {
  const value = url.trim();

  if (!value) {
    return "请输入 API URL";
  }

  if (value.length > 2048) {
    return "URL 长度不能超过 2048 个字符";
  }

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

  if (!value) {
    return "请输入 API Key";
  }

  if (value.length > 256) {
    return "API Key 长度不能超过 256 个字符";
  }

  if (SHELL_META_PATTERN.test(value)) {
    return "API Key 不能包含 shell 元字符";
  }

  return undefined;
}

function ConfigPanel({ tools, onSave, onSkip }: ConfigPanelProps) {
  const configurableTools = useMemo(() => tools.filter(needsConfig), [tools]);
  const [form, setForm] = useState<Record<string, ConfigFormState>>(() =>
    Object.fromEntries(
      configurableTools.map((tool) => [
        tool,
        {
          api_url: "",
          api_key: "",
        },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, FieldErrors>>({});

  const updateField = (tool: string, field: keyof ConfigFormState, value: string) => {
    setForm((current) => ({
      ...current,
      [tool]: {
        ...(current[tool] ?? { api_url: "", api_key: "" }),
        [field]: value,
      },
    }));

    setErrors((current) => ({
      ...current,
      [tool]: {
        ...current[tool],
        [field]: undefined,
      },
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
        nextErrors[tool] = {
          api_key: apiKeyError,
          api_url: apiUrlError,
        };
      }

      return {
        tool_name: tool,
        api_key: toolForm.api_key.trim(),
        api_url: isKeyOnly ? undefined : toolForm.api_url.trim(),
      };
    });

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onSave(entries);
  };

  return (
    <section className="flex h-full flex-col gap-5">
      <div
        className="rounded-2xl border p-5"
        style={{
          background: theme.card,
          borderColor: theme.cardBorder,
          borderRadius: theme.radius,
        }}
      >
        <h2 className="text-2xl font-semibold text-white">配置 API 凭据</h2>
        <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
          仅为需要凭据的工具填写配置，不会写入 localStorage。
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {configurableTools.length === 0 ? (
          <div
            className="rounded-2xl border p-6 text-sm"
            style={{
              background: theme.card,
              borderColor: theme.cardBorder,
              borderRadius: theme.radius,
              color: theme.textSecondary,
            }}
          >
            当前未选择需要配置的工具。
          </div>
        ) : (
          configurableTools.map((tool) => {
            const toolForm = form[tool] ?? { api_url: "", api_key: "" };
            const toolErrors = errors[tool] ?? {};

            return (
              <div
                className="rounded-2xl border p-5"
                key={tool}
                style={{
                  background: theme.card,
                  borderColor: theme.cardBorder,
                  borderRadius: theme.radius,
                }}
              >
                <h3 className="text-lg font-semibold text-white">{tool}</h3>

                <div className="mt-4 grid gap-4">
                  {!KEY_ONLY_TOOLS.includes(tool) && (
                  <div>
                    <label className="mb-2 block text-sm font-medium" style={{ color: theme.textSecondary }}>
                      API URL
                    </label>
                    <input
                      className="w-full rounded-xl border px-4 py-3 text-sm text-white outline-none transition focus:border-white/30"
                      onChange={(event) => updateField(tool, "api_url", event.target.value)}
                      placeholder="https://api.example.com"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        borderColor: toolErrors.api_url ? theme.error : theme.cardBorder,
                      }}
                      type="url"
                      value={toolForm.api_url}
                    />
                    {toolErrors.api_url ? (
                      <p className="mt-2 text-xs" style={{ color: theme.error }}>
                        {toolErrors.api_url}
                      </p>
                    ) : null}
                  </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-medium" style={{ color: theme.textSecondary }}>
                      API Key
                    </label>
                    <input
                      className="w-full rounded-xl border px-4 py-3 text-sm text-white outline-none transition focus:border-white/30"
                      onChange={(event) => updateField(tool, "api_key", event.target.value)}
                      placeholder="请输入 API Key"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        borderColor: toolErrors.api_key ? theme.error : theme.cardBorder,
                      }}
                      type="password"
                      value={toolForm.api_key}
                    />
                    {toolErrors.api_key ? (
                      <p className="mt-2 text-xs" style={{ color: theme.error }}>
                        {toolErrors.api_key}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          className="rounded-full border px-4 py-2.5 text-sm font-medium transition duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/8"
          onClick={onSkip}
          style={{
            background: theme.card,
            borderColor: theme.cardBorder,
            color: theme.textSecondary,
          }}
          type="button"
        >
          跳过
        </button>
        <button
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-110"
          onClick={handleSave}
          style={{ background: theme.accent }}
          type="button"
        >
          保存配置
        </button>
      </div>
    </section>
  );
}

export default ConfigPanel;
