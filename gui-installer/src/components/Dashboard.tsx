import { useMemo, useState } from "react";

import { DEFAULT_TOOL_CONFIGS, keysForTool, maskKey, toolNameForConfig } from "../lib/toolKeys";
import { theme } from "../styles/theme";
import type {
  AiToolDefinition,
  AiToolId,
  ApiKey,
  ChannelConfig,
  DetectResult,
  LaunchMode,
  ToolKeySelections,
  UserProfile,
} from "../types";

const AI_TOOLS: AiToolDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    detectName: "Codex CLI",
    normalCommand: "codex",
    elevatedCommand: "codex --dangerously-bypass-approvals-and-sandbox",
  },
  {
    id: "claude",
    name: "Claude",
    detectName: "Claude CLI",
    normalCommand: "claude",
    elevatedCommand: "claude --dangerously-skip-permissions",
  },
  {
    id: "gemini",
    name: "Gemini",
    detectName: "Gemini CLI",
    normalCommand: "gemini",
    elevatedCommand: "gemini --yolo",
  },
  {
    id: "opencode",
    name: "OpenCode",
    detectName: "OpenCode",
    normalCommand: "opencode",
    elevatedCommand: "OPENCODE_PERMISSION=allow opencode",
  },
];

interface DashboardProps {
  tools: DetectResult[];
  error?: string | null;
  apiKeys: ApiKey[];
  keySelections: ToolKeySelections;
  profile: UserProfile | null;
  balanceLoading: boolean;
  channels: ChannelConfig[];
  currentChannel: ChannelConfig;
  onInstall: (toolName?: string) => void;
  onLaunch: (tool: AiToolId, mode: LaunchMode) => void;
  onRefresh: () => void;
  onRefreshBalance: () => void;
  onRecharge: () => void;
  onSaveChannel: (channel: ChannelConfig) => void;
  onSwitchChannel: (id: string) => void;
  onSelectToolKey: (tool: AiToolId, keyId: number) => void;
  onLogout: () => void;
}

function Dashboard({
  tools,
  error,
  apiKeys,
  keySelections,
  profile,
  balanceLoading,
  channels,
  currentChannel,
  onInstall,
  onLaunch,
  onRefresh,
  onRefreshBalance,
  onRecharge,
  onSaveChannel,
  onSwitchChannel,
  onSelectToolKey,
  onLogout,
}: DashboardProps) {
  const [selectedTool, setSelectedTool] = useState<AiToolDefinition | null>(null);
  const [editingChannel, setEditingChannel] = useState<ChannelConfig | null>(null);
  const missingRequired = tools.filter((tool) => tool.required && !tool.installed);
  const upgradableTools = tools.filter((tool) => tool.upgradable);
  const installedAiTools = AI_TOOLS.filter((tool) => findTool(tools, tool.detectName)?.installed);

  const versionByName = useMemo(
    () => Object.fromEntries(tools.map((tool) => [tool.name, tool])),
    [tools],
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
            AI 环境工作台
          </h1>
          <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
            当前账号：{profile?.email ?? "已登录"}；当前渠道：{currentChannel.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-lg px-3 py-1.5 text-xs font-medium" onClick={onRefresh} style={secondaryButtonStyle()} type="button">
            刷新环境
          </button>
          <button className="rounded-lg px-3 py-1.5 text-xs font-medium" onClick={() => setEditingChannel(newChannel())} style={secondaryButtonStyle()} type="button">
            新增渠道
          </button>
          <button className="rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={() => onInstall()} style={{ background: theme.accent, color: theme.textOnAccent }} type="button">
            安装/升级
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs">
        <StatusPill label="必要环境" value={missingRequired.length === 0 ? "正常" : "缺失"} tone={missingRequired.length === 0 ? "success" : "error"} />
        <StatusPill label="可用工具" value={`${installedAiTools.length}/4`} tone="neutral" />
        <StatusPill label="可升级" value={`${upgradableTools.length}`} tone={upgradableTools.length > 0 ? "warning" : "neutral"} />
        <StatusPill label="账户余额" value={formatBalance(profile?.balance, balanceLoading)} tone="neutral" />
      </div>

      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ background: theme.bgTertiary, color: theme.textSecondary }}>
        <div className="flex items-center gap-2">
          <span>切换渠道</span>
          <select
            className="rounded-md border px-2 py-1"
            onChange={(event) => onSwitchChannel(event.target.value)}
            style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
            value={currentChannel.id}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
          {!currentChannel.isDefault && (
            <button onClick={() => setEditingChannel(currentChannel)} style={{ color: theme.accent }} type="button">
              编辑渠道
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onRefreshBalance} style={{ color: theme.textSecondary }} type="button">
            刷新余额
          </button>
          <button onClick={onRecharge} style={{ color: theme.accent }} type="button">
            充值
          </button>
          <button onClick={onLogout} style={{ color: theme.textSecondary }} type="button">
            退出登录
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: theme.errorLight, borderColor: theme.error, color: theme.error }}>
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1">
        {AI_TOOLS.map((tool) => {
          const detected = versionByName[tool.detectName];
          const installed = detected?.installed ?? false;
          const upgradable = detected?.upgradable ?? false;
          const matchingKeys = keysForTool(apiKeys, tool.id);
          const selectedKey = matchingKeys.find((key) => key.id === keySelections[tool.id]) ?? matchingKeys[0];
          const customConfig = currentChannel.toolConfigs[tool.id];

          return (
            <button
              className="flex min-h-[150px] flex-col justify-between rounded-lg border p-4 text-left transition-all duration-150 hover:-translate-y-px"
              key={tool.id}
              onClick={() => (installed ? setSelectedTool(tool) : onInstall(tool.detectName))}
              style={{
                background: theme.card,
                borderColor: upgradable ? theme.warning : theme.cardBorder,
                boxShadow: theme.cardShadow,
                color: theme.textPrimary,
              }}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{tool.name}</h2>
                  <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
                    {installed ? "点击配置并打开终端" : "未安装，点击安装"}
                  </p>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: installed ? theme.successLight : theme.bgTertiary, color: installed ? theme.success : theme.textMuted }}>
                  {installed ? "可用" : "未安装"}
                </span>
              </div>

              <div className="space-y-1 text-xs" style={{ color: theme.textSecondary }}>
                <div>当前版本：{detected?.current_version ?? "-"}</div>
                <div>最新版本：{detected?.available_version ?? "-"}</div>
                <div>
                  Key：{currentChannel.isDefault
                    ? selectedKey ? `${selectedKey.name} (${maskKey(selectedKey.key)})` : "无匹配 Key"
                    : customConfig?.apiKey ? maskKey(customConfig.apiKey) : "未配置"}
                </div>
                {upgradable && <div className="font-medium" style={{ color: theme.warning }}>可升级</div>}
              </div>
            </button>
          );
        })}
      </div>

      {selectedTool && (
        <LaunchDialog
          apiKeys={apiKeys}
          channel={currentChannel}
          keySelections={keySelections}
          onCancel={() => setSelectedTool(null)}
          onLaunch={(mode) => {
            if (mode === "elevated") {
              const ok = window.confirm("最高权限模式会绕过审批或沙箱限制，可能修改本机文件。确认继续？");
              if (!ok) return;
            }
            onLaunch(selectedTool.id, mode);
            setSelectedTool(null);
          }}
          onSelectToolKey={onSelectToolKey}
          selectedTool={selectedTool}
        />
      )}

      {editingChannel && (
        <ChannelDialog
          channel={editingChannel}
          onCancel={() => setEditingChannel(null)}
          onSave={(channel) => {
            onSaveChannel(channel);
            setEditingChannel(null);
          }}
        />
      )}
    </section>
  );
}

function LaunchDialog({
  selectedTool,
  channel,
  apiKeys,
  keySelections,
  onSelectToolKey,
  onCancel,
  onLaunch,
}: {
  selectedTool: AiToolDefinition;
  channel: ChannelConfig;
  apiKeys: ApiKey[];
  keySelections: ToolKeySelections;
  onSelectToolKey: (tool: AiToolId, keyId: number) => void;
  onCancel: () => void;
  onLaunch: (mode: LaunchMode) => void;
}) {
  const matchingKeys = keysForTool(apiKeys, selectedTool.id);
  const selectedKey = matchingKeys.find((key) => key.id === keySelections[selectedTool.id]) ?? matchingKeys[0];
  const config = channel.toolConfigs[selectedTool.id];
  const canLaunch = channel.isDefault ? Boolean(selectedKey) : Boolean(config?.baseUrl && config?.apiKey);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/20">
      <div className="w-[460px] rounded-lg border p-5" style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadowHover }}>
        <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
          打开 {selectedTool.name}
        </h2>

        <div className="mt-4 grid gap-3">
          {channel.isDefault ? (
            <label className="grid gap-1.5 text-sm" style={{ color: theme.textSecondary }}>
              芝麻灵码 Key
              <select
                className="rounded-lg border px-3 py-2 outline-none"
                disabled={matchingKeys.length === 0}
                onChange={(event) => onSelectToolKey(selectedTool.id, Number(event.target.value))}
                style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
                value={selectedKey?.id ?? ""}
              >
                {matchingKeys.length === 0 && <option value="">没有匹配的账户 Key</option>}
                {matchingKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.name} / {key.group?.name ?? "未分组"} / {maskKey(key.key)} / 已用 {key.quota_used}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: theme.bgTertiary, color: theme.textSecondary }}>
              当前使用自定义渠道配置：{config?.baseUrl || "未配置"} / {config?.apiKey ? maskKey(config.apiKey) : "未配置 Key"}
            </div>
          )}

          <LaunchButton command={selectedTool.normalCommand} disabled={!canLaunch} label="普通模式" onClick={() => onLaunch("normal")} />
          <LaunchButton command={selectedTool.elevatedCommand} disabled={!canLaunch} label="最高权限" onClick={() => onLaunch("elevated")} warning />
        </div>
        <div className="mt-4 flex justify-end">
          <button className="rounded-lg px-3 py-1.5 text-sm" onClick={onCancel} style={{ color: theme.textSecondary }} type="button">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelDialog({
  channel,
  onSave,
  onCancel,
}: {
  channel: ChannelConfig;
  onSave: (channel: ChannelConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(channel);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/20">
      <div className="w-[620px] rounded-lg border p-5" style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadowHover }}>
        <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>自定义渠道</h2>
        <div className="mt-4 grid max-h-[430px] gap-3 overflow-y-auto pr-1">
          <Field label="名称" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          {(["claude", "codex", "gemini", "opencode"] as AiToolId[]).map((tool) => (
            <div className="rounded-lg border p-3" key={tool} style={{ borderColor: theme.border }}>
              <div className="mb-2 text-sm font-semibold" style={{ color: theme.textPrimary }}>{toolNameForConfig(tool)}</div>
              <Field
                label="Base URL"
                value={draft.toolConfigs[tool]?.baseUrl ?? ""}
                onChange={(baseUrl) => setDraft(updateToolConfig(draft, tool, { baseUrl }))}
              />
              <div className="mt-2">
                <Field
                  label="API Key"
                  type="password"
                  value={draft.toolConfigs[tool]?.apiKey ?? ""}
                  onChange={(apiKey) => setDraft(updateToolConfig(draft, tool, { apiKey }))}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} style={{ color: theme.textSecondary }} type="button">取消</button>
          <button
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            onClick={() => onSave({ ...draft, id: draft.id || `custom-${Date.now()}`, isDefault: false })}
            style={{ background: theme.accent, color: theme.textOnAccent }}
            type="button"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm" style={{ color: theme.textSecondary }}>
      {label}
      <input
        className="rounded-lg border px-3 py-2 outline-none"
        onChange={(event) => onChange(event.target.value)}
        style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
        type={type}
        value={value}
      />
    </label>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "error" | "neutral" }) {
  const color = tone === "success" ? theme.success : tone === "warning" ? theme.warning : tone === "error" ? theme.error : theme.textSecondary;
  const background = tone === "success" ? theme.successLight : tone === "warning" ? theme.warningLight : tone === "error" ? theme.errorLight : theme.bgTertiary;

  return (
    <div className="rounded-lg px-3 py-2" style={{ background }}>
      <div style={{ color: theme.textMuted }}>{label}</div>
      <div className="mt-1 font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

function LaunchButton({ label, command, warning, disabled, onClick }: { label: string; command: string; warning?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      className="rounded-lg border px-3 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      style={{ background: warning ? theme.warningLight : theme.bgSecondary, borderColor: warning ? theme.warning : theme.border, color: theme.textPrimary }}
      type="button"
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-1 font-mono text-xs" style={{ color: theme.textSecondary }}>{command}</div>
    </button>
  );
}

function findTool(tools: DetectResult[], name: string) {
  return tools.find((tool) => tool.name === name);
}

function newChannel(): ChannelConfig {
  return {
    id: `custom-${Date.now()}`,
    name: "自定义渠道",
    toolConfigs: { ...DEFAULT_TOOL_CONFIGS },
    isDefault: false,
  };
}

function updateToolConfig(channel: ChannelConfig, tool: AiToolId, patch: Partial<{ baseUrl: string; apiKey: string }>): ChannelConfig {
  return {
    ...channel,
    toolConfigs: {
      ...channel.toolConfigs,
      [tool]: {
        ...(channel.toolConfigs[tool] ?? { baseUrl: "", apiKey: "" }),
        ...patch,
      },
    },
  };
}

function formatBalance(balance: number | undefined, loading: boolean) {
  if (loading && balance === undefined) return "读取中";
  if (balance === undefined) return "-";
  return `￥${balance.toFixed(2)}`;
}

function secondaryButtonStyle() {
  return { background: theme.bgTertiary, color: theme.textSecondary };
}

export default Dashboard;
