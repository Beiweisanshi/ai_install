import { useMemo, useState } from "react";
import SettingsDrawer from "./SettingsDrawer";
import { formatText, t } from "../lib/strings";
import { DEFAULT_TOOL_CONFIGS, keysForTool, maskKey, toolNameForConfig } from "../lib/toolKeys";
import { theme } from "../styles/theme";
import { useDialogKeyboard } from "../hooks/useDialogKeyboard";
import type {
  AiToolDefinition,
  AiToolId,
  AppVersionInfo,
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
  appVersionInfo: AppVersionInfo | null;
  darkMode: boolean;
  rememberLogin: boolean;
  detectInterval: number;
  onInstall: (toolName?: string) => void;
  onDeleteChannel: (id: string) => void;
  onOpenKeyManager: () => void;
  onLaunch: (tool: AiToolId, mode: LaunchMode) => void;
  onRefresh: () => void;
  onRefreshBalance: () => void;
  onRecharge: () => void;
  onSaveChannel: (channel: ChannelConfig) => void;
  onSwitchChannel: (id: string) => void;
  onSelectToolKey: (tool: AiToolId, keyId: number) => void;
  onDarkModeChange: (enabled: boolean) => void;
  onRememberLoginChange: (enabled: boolean) => void;
  onDetectIntervalChange: (seconds: number) => void;
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
  appVersionInfo,
  darkMode,
  rememberLogin,
  detectInterval,
  onInstall,
  onDeleteChannel,
  onOpenKeyManager,
  onLaunch,
  onRefresh,
  onRefreshBalance,
  onRecharge,
  onSaveChannel,
  onSwitchChannel,
  onSelectToolKey,
  onDarkModeChange,
  onRememberLoginChange,
  onDetectIntervalChange,
  onLogout,
}: DashboardProps) {
  const [selectedTool, setSelectedTool] = useState<AiToolDefinition | null>(null);
  const [dangerTool, setDangerTool] = useState<AiToolDefinition | null>(null);
  const [editingChannel, setEditingChannel] = useState<ChannelConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteChannel, setDeleteChannel] = useState<ChannelConfig | null>(null);
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
            {t("app.dashboard")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
            {formatText("dashboard.account", { email: profile?.email ?? t("dashboard.loggedIn") })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1.5 text-xs" style={{ color: theme.textSecondary }}>
            {t("dashboard.channel")}
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
          </label>
          {!currentChannel.isDefault && (
            <>
              <button className="btn btn-secondary rounded-lg px-2.5 py-1.5 text-xs font-medium" onClick={() => setEditingChannel(currentChannel)} type="button">
                {t("common.edit")}
              </button>
              <button className="btn btn-danger rounded-lg px-2.5 py-1.5 text-xs font-medium" onClick={() => setDeleteChannel(currentChannel)} type="button">
                {t("common.delete")}
              </button>
            </>
          )}
          <button className="btn btn-secondary rounded-lg px-2.5 py-1.5 text-xs font-medium" onClick={() => setEditingChannel(newChannel())} type="button">
            {t("dashboard.new")}
          </button>
          <button className="btn btn-secondary rounded-lg px-3 py-1.5 text-xs font-medium" onClick={onRefresh} type="button">
            {t("dashboard.refresh")}
          </button>
          <button className="btn btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={() => onInstall()} type="button">
            {t("dashboard.installUpgrade")}
          </button>
          <button className="btn btn-secondary rounded-lg px-2.5 py-1.5 text-xs font-medium" onClick={() => setSettingsOpen(true)} type="button" title={t("dashboard.settings")}>
            {t("dashboard.settings")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs">
        <StatusPill label={t("dashboard.requiredEnv")} value={missingRequired.length === 0 ? t("dashboard.normal") : t("dashboard.missing")} tone={missingRequired.length === 0 ? "success" : "error"} />
        <StatusPill label={t("dashboard.availableTools")} value={`${installedAiTools.length}/4`} tone="neutral" />
        <StatusPill label={t("dashboard.upgradable")} value={`${upgradableTools.length}`} tone={upgradableTools.length > 0 ? "warning" : "neutral"} />
        <StatusPill label={t("dashboard.balance")} value={formatBalance(profile?.balance, balanceLoading)} tone="neutral" />
      </div>

      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ background: theme.bgTertiary, color: theme.textSecondary }}>
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: theme.accent }} />
          {formatText("dashboard.currentChannel", { name: currentChannel.name })}
        </span>
        <div className="flex items-center gap-3">
          <button className="btn btn-text" onClick={onRefreshBalance} style={{ color: theme.textSecondary }} type="button">
            {t("dashboard.refreshBalance")}
          </button>
          <button className="btn btn-text" onClick={onRecharge} style={{ color: theme.accent }} type="button">
            {t("dashboard.recharge")}
          </button>
          <button className="btn btn-text" onClick={onLogout} style={{ color: theme.textSecondary }} type="button">
            {t("dashboard.logout")}
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
            <div
              className={`flex min-h-[180px] flex-col justify-between rounded-lg border p-4 ${installed ? "" : "opacity-75"}`}
              key={tool.id}
              role="article"
              style={{
                background: installed ? theme.card : theme.bgTertiary,
                borderColor: upgradable ? theme.warning : theme.cardBorder,
                boxShadow: theme.cardShadow,
                color: theme.textPrimary,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{tool.name}</h2>
                  <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
                    {installed ? t("dashboard.installedDescription") : t("dashboard.notInstalled")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {upgradable && (
                    <button className="btn btn-secondary rounded-full px-2 py-0.5 text-[11px] font-medium" onClick={() => onInstall(tool.detectName)} style={{ background: theme.warningLight, color: theme.warning }} type="button">
                      {t("dashboard.upgradable")}
                    </button>
                  )}
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: installed ? theme.successLight : theme.bgTertiary, color: installed ? theme.success : theme.textMuted }}>
                    {installed ? t("dashboard.available") : t("dashboard.notInstalled")}
                  </span>
                </div>
              </div>

              <div className="space-y-1 text-xs" style={{ color: theme.textSecondary }}>
                <div>{formatText("dashboard.currentVersion", { version: detected?.current_version ?? "-" })}</div>
                <div>{formatText("dashboard.latestVersion", { version: detected?.available_version ?? "-" })}</div>
                {installed && (
                  <div className="grid gap-1">
                    <span>Key</span>
                    {currentChannel.isDefault ? (
                      matchingKeys.length > 0 ? (
                        <select
                          className="rounded-md border px-2 py-1"
                          onChange={(event) => onSelectToolKey(tool.id, Number(event.target.value))}
                          style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
                          value={selectedKey?.id ?? ""}
                        >
                          {matchingKeys.map((key) => (
                            <option key={key.id} value={key.id}>{key.name} ({maskKey(key.key)})</option>
                          ))}
                        </select>
                      ) : (
                        <button className="btn btn-text text-left font-medium" onClick={onOpenKeyManager} style={{ color: theme.accent }} type="button">
                          {t("dashboard.createKey")}
                        </button>
                      )
                    ) : (
                      <span>{customConfig?.apiKey ? maskKey(customConfig.apiKey) : t("common.unconfigured")}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 flex justify-end">
                {installed ? (
                  <button className="btn btn-primary rounded-lg px-3 py-2 text-sm font-semibold" onClick={() => setSelectedTool(tool)} type="button">
                    {t("dashboard.openTerminal")}
                  </button>
                ) : (
                  <button className="btn btn-primary rounded-lg px-3 py-2 text-sm font-semibold" onClick={() => onInstall(tool.detectName)} type="button">
                    {t("dashboard.install")}
                  </button>
                )}
              </div>
            </div>
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
              setDangerTool(selectedTool);
              return;
            }
            onLaunch(selectedTool.id, mode);
            setSelectedTool(null);
          }}
          onSelectToolKey={onSelectToolKey}
          selectedTool={selectedTool}
        />
      )}

      {dangerTool && (
        <DangerConfirmDialog
          onCancel={() => setDangerTool(null)}
          onConfirm={() => {
            onLaunch(dangerTool.id, "elevated");
            setDangerTool(null);
            setSelectedTool(null);
          }}
          tool={dangerTool}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          appVersionInfo={appVersionInfo}
          channels={channels}
          currentChannelId={currentChannel.id}
          darkMode={darkMode}
          detectInterval={detectInterval}
          onClose={() => setSettingsOpen(false)}
          onDarkModeChange={onDarkModeChange}
          onDeleteChannel={(id) => {
            const channel = channels.find((item) => item.id === id);
            if (channel) setDeleteChannel(channel);
          }}
          onDetectIntervalChange={onDetectIntervalChange}
          onEditChannel={(channel) => {
            setEditingChannel(channel);
            setSettingsOpen(false);
          }}
          onNewChannel={() => {
            setEditingChannel(newChannel());
            setSettingsOpen(false);
          }}
          onRememberLoginChange={onRememberLoginChange}
          onSwitchChannel={onSwitchChannel}
          rememberLogin={rememberLogin}
        />
      )}

      {deleteChannel && (
        <DeleteChannelDialog
          channel={deleteChannel}
          onCancel={() => setDeleteChannel(null)}
          onConfirm={() => {
            onDeleteChannel(deleteChannel.id);
            setDeleteChannel(null);
          }}
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
  const dialogRef = useDialogKeyboard<HTMLDivElement>(true, onCancel);
  const matchingKeys = keysForTool(apiKeys, selectedTool.id);
  const selectedKey = matchingKeys.find((key) => key.id === keySelections[selectedTool.id]) ?? matchingKeys[0];
  const config = channel.toolConfigs[selectedTool.id];
  const canLaunch = channel.isDefault ? Boolean(selectedKey) : Boolean(config?.baseUrl && config?.apiKey);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/45 px-4">
      <div
        className="w-[460px] max-w-[90vw] max-h-[85vh] overflow-y-auto rounded-lg border p-5"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadowHover }}
      >
        <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
          {formatText("dashboard.launchTitle", { toolName: selectedTool.name })}
        </h2>

        <div className="mt-4 grid gap-3">
          {channel.isDefault ? (
            <label className="grid gap-1.5 text-sm" style={{ color: theme.textSecondary }}>
              {t("dashboard.zmKey")}
              <select
                className="rounded-lg border px-3 py-2"
                disabled={matchingKeys.length === 0}
                onChange={(event) => onSelectToolKey(selectedTool.id, Number(event.target.value))}
                style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
                value={selectedKey?.id ?? ""}
              >
                {matchingKeys.length === 0 && <option value="">{t("dashboard.noMatchingKey")}</option>}
                {matchingKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.name} / {key.group?.name ?? t("dashboard.ungrouped")} / {maskKey(key.key)} / {formatText("dashboard.usedQuota", { quota: key.quota_used })}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: theme.bgTertiary, color: theme.textSecondary }}>
              {formatText("dashboard.customChannelConfig", { baseUrl: config?.baseUrl || t("common.unconfigured"), apiKey: config?.apiKey ? maskKey(config.apiKey) : t("common.unconfiguredKey") })}
            </div>
          )}

          <LaunchButton command={selectedTool.normalCommand} disabled={!canLaunch} label={t("dashboard.normalMode")} onClick={() => onLaunch("normal")} />
          <LaunchButton command={selectedTool.elevatedCommand} disabled={!canLaunch} label={t("dashboard.elevatedMode")} onClick={() => onLaunch("elevated")} warning />
          <p className="text-[11px] leading-relaxed" style={{ color: theme.textMuted }}>
            {t("dashboard.envNotice")}
          </p>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="btn btn-text rounded-lg px-3 py-1.5 text-sm" onClick={onCancel} style={{ color: theme.textSecondary }} type="button">
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DangerConfirmDialog({
  tool,
  onConfirm,
  onCancel,
}: {
  tool: AiToolDefinition;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const dialogRef = useDialogKeyboard<HTMLDivElement>(true, onCancel);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 px-4">
      <div
        className="w-[480px] max-w-[90vw] rounded-lg border p-5"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{ background: theme.card, borderColor: theme.error, boxShadow: theme.cardShadowHover }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold"
            style={{ background: theme.errorLight, color: theme.error }}
            aria-hidden="true"
          >
            !
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
              {formatText("dashboard.dangerTitle", { toolName: tool.name })}
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.textSecondary }}>
              {t("dashboard.dangerCommandPrefix")} <span className="break-all font-mono text-xs">{tool.elevatedCommand}</span>。{dangerDescription(tool.id)}
            </p>
          </div>
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm" style={{ color: theme.textSecondary }}>
          <input
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            type="checkbox"
          />
          {t("dashboard.acceptRisk")}
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-text rounded-lg px-3 py-2 text-sm" onClick={onCancel} style={{ color: theme.textSecondary }} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-danger rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!accepted}
            onClick={onConfirm}
            style={{ background: theme.error, color: theme.textOnAccent }}
            type="button"
          >
            {t("dashboard.continueLaunch")}
          </button>
        </div>
      </div>
    </div>
  );
}

function dangerDescription(tool: AiToolId) {
  if (tool === "codex") return t("dashboard.danger.codex");
  if (tool === "claude") return t("dashboard.danger.claude");
  if (tool === "gemini") return t("dashboard.danger.gemini");
  return t("dashboard.danger.opencode");
}

function DeleteChannelDialog({
  channel,
  onConfirm,
  onCancel,
}: {
  channel: ChannelConfig;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogKeyboard<HTMLDivElement>(true, onCancel);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4">
      <div
        className="w-[420px] max-w-[90vw] rounded-lg border p-5"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{ background: theme.card, borderColor: theme.error, boxShadow: theme.cardShadowHover }}
      >
        <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>{t("dashboard.deleteChannelTitle")}</h2>
        <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
          {formatText("dashboard.deleteChannelDescription", { name: channel.name })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-text rounded-lg px-3 py-2 text-sm" onClick={onCancel} style={{ color: theme.textSecondary }} type="button">
            {t("common.cancel")}
          </button>
          <button className="btn btn-danger rounded-lg px-4 py-2 text-sm font-semibold" onClick={onConfirm} style={{ background: theme.error, color: theme.textOnAccent }} type="button">
            {t("common.delete")}
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
  const [activeTool, setActiveTool] = useState<AiToolId>("claude");
  const dialogRef = useDialogKeyboard<HTMLDivElement>(true, onCancel);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/45 px-4">
      <div
        className="w-[620px] max-w-[90vw] max-h-[85vh] overflow-y-auto rounded-lg border p-5"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{ background: theme.card, borderColor: theme.cardBorder, boxShadow: theme.cardShadowHover }}
      >
        <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>{t("dashboard.channelDialogTitle")}</h2>
        <div className="mt-4 grid gap-3">
          <Field label={t("dashboard.name")} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          <div className="grid grid-cols-4 gap-1 rounded-lg p-1" style={{ background: theme.bgTertiary }}>
            {(["claude", "codex", "gemini", "opencode"] as AiToolId[]).map((tool) => (
              <button
                className="btn btn-secondary rounded-md px-2 py-1.5 text-xs font-medium"
                key={tool}
                onClick={() => setActiveTool(tool)}
                style={{ background: activeTool === tool ? theme.card : "transparent", color: activeTool === tool ? theme.textPrimary : theme.textSecondary }}
                type="button"
              >
                {toolNameForConfig(tool)}
              </button>
            ))}
          </div>
          <div className="rounded-lg border p-3" style={{ borderColor: theme.border }}>
            <div className="mb-2 text-sm font-semibold" style={{ color: theme.textPrimary }}>{toolNameForConfig(activeTool)}</div>
            <Field
              label="Base URL"
              value={draft.toolConfigs[activeTool]?.baseUrl ?? ""}
              onChange={(baseUrl) => setDraft(updateToolConfig(draft, activeTool, { baseUrl }))}
            />
            <div className="mt-2">
              <Field
                label="API Key"
                type="password"
                value={draft.toolConfigs[activeTool]?.apiKey ?? ""}
                onChange={(apiKey) => setDraft(updateToolConfig(draft, activeTool, { apiKey }))}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["claude", "codex", "gemini", "opencode"] as AiToolId[])
                .filter((tool) => tool !== activeTool && draft.toolConfigs[tool]?.baseUrl)
                .map((tool) => (
                  <button
                    className="btn btn-text rounded-md px-2 py-1 text-xs"
                    key={tool}
                    onClick={() => setDraft(updateToolConfig(draft, activeTool, { baseUrl: draft.toolConfigs[tool]?.baseUrl ?? "" }))}
                    style={{ color: theme.accent }}
                    type="button"
                  >
                    {formatText("dashboard.copyBaseUrl", { toolName: toolNameForConfig(tool) })}
                  </button>
                ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-text" onClick={onCancel} style={{ color: theme.textSecondary }} type="button">{t("common.cancel")}</button>
          <button
            className="btn btn-primary rounded-lg px-4 py-2 text-sm font-semibold"
            onClick={() => onSave({ ...draft, id: draft.id || `custom-${Date.now()}`, isDefault: false })}
            type="button"
          >
            {t("common.save")}
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
    <label className="input-wrap grid gap-1.5 text-sm" style={{ color: theme.textSecondary }}>
      {label}
      <input
        className="rounded-lg border px-3 py-2"
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
    <div className="rounded-lg px-4 py-3" style={{ background }}>
      <div className="text-[11px]" style={{ color: theme.textMuted }}>{label}</div>
      <div className="mt-1 text-base font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

function LaunchButton({ label, command, warning, disabled, onClick }: { label: string; command: string; warning?: boolean; disabled?: boolean; onClick: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyCommand(event: { stopPropagation: () => void }) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="rounded-lg border"
      style={{
        background: warning ? theme.warningLight : theme.bgSecondary,
        borderColor: warning ? theme.warning : theme.border,
        color: theme.textPrimary,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <button
        className="btn btn-secondary block w-full rounded-t-lg px-3 py-2 text-left disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={onClick}
        style={{ background: "transparent" }}
        type="button"
      >
        <div className="text-sm font-semibold">{label}</div>
      </button>
      <div className="flex items-center gap-2 border-t px-3 py-1.5" style={{ borderColor: warning ? theme.warning : theme.border }}>
        <span className="min-w-0 flex-1 break-all font-mono text-xs" style={{ color: theme.textSecondary }}>{command}</span>
        <button
          className="btn btn-secondary shrink-0 rounded-md px-2 py-1 text-xs"
          onClick={(event) => void copyCommand(event)}
          style={{ background: theme.bgTertiary, color: theme.textSecondary }}
          type="button"
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
    </div>
  );
}

function findTool(tools: DetectResult[], name: string) {
  return tools.find((tool) => tool.name === name);
}

function newChannel(): ChannelConfig {
  return {
    id: `custom-${Date.now()}`,
    name: t("app.customChannelName"),
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
  if (loading && balance === undefined) return t("common.loading");
  if (balance === undefined) return "-";
  return `￥${balance.toFixed(2)}`;
}

export default Dashboard;
