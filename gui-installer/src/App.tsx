import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import AuthPanel from "./components/AuthPanel";
import BlockingProcessesModal from "./components/BlockingProcessesModal";
import Dashboard from "./components/Dashboard";
import Layout from "./components/Layout";
import Summary from "./components/Summary";
import ToolList from "./components/ToolList";
import {
  getPaymentCheckoutInfo,
  getUserProfile,
  listApiKeys,
  PUBLIC_BASE_URL,
} from "./lib/backendApi";
import {
  clearSession,
  loadChannels,
  loadCurrentChannelId,
  loadSession,
  loadToolKeySelections,
  saveChannels,
  saveCurrentChannelId,
  saveSession,
  saveToolKeySelections,
} from "./lib/storage";
import { DEFAULT_TOOL_CONFIGS, keysForTool, toolNameForConfig, TOOL_IDS } from "./lib/toolKeys";
import { useInstaller } from "./hooks/useInstaller";
import { useSmoothedProgress } from "./hooks/useSmoothedProgress";
import { theme } from "./styles/theme";
import type {
  AiToolId,
  ApiKey,
  AppPhase,
  AuthSession,
  ChannelConfig,
  ConfigEntry,
  LaunchMode,
  ToolChannelConfig,
  ToolKeySelections,
  UserProfile,
} from "./types";

function App() {
  const installer = useInstaller();
  const smoothedProgress = useSmoothedProgress(installer.progress);
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [keySelections, setKeySelections] = useState<ToolKeySelections>(() => loadToolKeySelections());
  const [channels, setChannels] = useState<ChannelConfig[]>(() => normalizeChannels(loadChannels()));
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(() => loadCurrentChannelId());
  const [channelError, setChannelError] = useState<string | null>(null);

  useEffect(() => {
    saveChannels(channels);
  }, [channels]);

  useEffect(() => {
    if (!session) return;
    void loadAccount(session);
  }, [session]);

  useEffect(() => {
    if (!session || apiKeys.length === 0) return;
    setKeySelections((current) => {
      const next = { ...current };
      let changed = false;
      for (const tool of TOOL_IDS) {
        const matching = keysForTool(apiKeys, tool);
        if (matching.length === 0) continue;
        if (!matching.some((key) => key.id === next[tool])) {
          next[tool] = matching[0].id;
          changed = true;
        }
      }
      if (changed) saveToolKeySelections(next);
      return changed ? next : current;
    });
  }, [apiKeys, session]);

  const effectiveChannels = useMemo(() => mergeDefaultChannel(channels), [channels]);

  const currentChannel = useMemo(() => {
    const existing = effectiveChannels.find((channel) => channel.id === currentChannelId);
    return existing ?? effectiveChannels[0];
  }, [currentChannelId, effectiveChannels]);

  useEffect(() => {
    if (currentChannelId && effectiveChannels.some((channel) => channel.id === currentChannelId)) return;
    saveCurrentChannelId("default");
    setCurrentChannelId("default");
  }, [currentChannelId, effectiveChannels]);

  const gatedPhase: AppPhase = installer.phase === "dashboard"
    ? !session
      ? "auth"
      : "dashboard"
    : installer.phase;

  const handleAuthenticated = (nextSession: AuthSession) => {
    setSession(nextSession);
    saveSession(nextSession);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setApiKeys([]);
    setProfile(null);
  };

  const handleSaveChannel = (channel: ChannelConfig) => {
    const normalized = normalizeChannel(channel);
    const next = upsertChannel(channels, normalized);
    setChannels(next);
    setCurrentChannelId(normalized.id);
    saveCurrentChannelId(normalized.id);
  };

  const handleSwitchChannel = (id: string) => {
    setCurrentChannelId(id);
    saveCurrentChannelId(id);
  };

  const handleSelectToolKey = (tool: AiToolId, keyId: number) => {
    const next = { ...keySelections, [tool]: keyId };
    setKeySelections(next);
    saveToolKeySelections(next);
  };

  const refreshBalance = useCallback(async () => {
    if (!session) return;
    setBalanceLoading(true);
    setChannelError(null);
    try {
      setProfile(await getUserProfile(session));
    } catch (e) {
      setChannelError(normalizeError(e));
    } finally {
      setBalanceLoading(false);
    }
  }, [session]);

  const openRecharge = async () => {
    if (!session) return;
    setChannelError(null);
    try {
      const checkout = await getPaymentCheckoutInfo(session);
      if (checkout.enabled === false || checkout.payment_enabled === false || checkout.balance_disabled === true) {
        setChannelError("当前服务器未开启充值。");
        return;
      }
    } catch {
      // Checkout-info is optional for desktop; still open the Web page.
    }

    try {
      await invoke("open_external_url", { url: `${PUBLIC_BASE_URL}/payment` });
    } catch {
      window.open(`${PUBLIC_BASE_URL}/payment`, "_blank", "noopener,noreferrer");
    }
  };

  const launchTool = async (tool: AiToolId, mode: LaunchMode) => {
    const resolved = resolveToolConfig(currentChannel, apiKeys, keySelections, tool);
    if (!resolved) {
      setChannelError(currentChannel.isDefault ? "当前工具没有匹配的账户 Key。" : "当前工具的自定义渠道未配置完整。");
      return;
    }

    setChannelError(null);
    try {
      if (tool !== "opencode") {
        const entry: ConfigEntry = {
          tool_name: toolNameForConfig(tool),
          api_url: resolved.baseUrl,
          api_key: resolved.apiKey,
        };
        await invoke("save_config", { entries: [entry] });
      }

      await invoke("launch_ai_tool", {
        tool,
        mode,
        envVars: envVarsForTool(tool, resolved),
      });
    } catch (e) {
      setChannelError(normalizeError(e));
    }
  };

  return (
    <Layout appVersionInfo={installer.appVersionInfo}>
      {installer.phase === "detecting" && (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
              style={{ color: theme.accent }}
            />
            <p className="text-sm" style={{ color: theme.textSecondary }}>
              正在检测当前环境...
            </p>
          </div>
        </div>
      )}

      {gatedPhase === "auth" && (
        <AuthPanel onAuthenticated={handleAuthenticated} />
      )}

      {gatedPhase === "dashboard" && session && currentChannel && (
        <Dashboard
          apiKeys={apiKeys}
          balanceLoading={balanceLoading || accountLoading}
          channels={effectiveChannels}
          currentChannel={currentChannel}
          error={installer.error || channelError}
          keySelections={keySelections}
          onInstall={installer.openInstall}
          onLaunch={launchTool}
          onLogout={handleLogout}
          onRecharge={openRecharge}
          onRefresh={() => {
            installer.startDetect();
            void loadAccount(session);
          }}
          onRefreshBalance={refreshBalance}
          onSaveChannel={handleSaveChannel}
          onSelectToolKey={handleSelectToolKey}
          onSwitchChannel={handleSwitchChannel}
          profile={profile}
          tools={installer.tools}
        />
      )}

      {(installer.phase === "selecting" || installer.phase === "installing") && (
        <ToolList
          installing={installer.phase === "installing"}
          logs={installer.logs}
          onBack={installer.goDashboard}
          onDeselectAll={installer.deselectAll}
          onSelectAll={installer.selectAll}
          onStartInstall={installer.startInstall}
          onToggle={installer.toggleTool}
          progress={smoothedProgress}
          selected={installer.selected}
          tools={installer.tools}
        />
      )}

      {installer.phase === "summary" && (
        <Summary results={installer.results} tools={installer.tools} />
      )}

      {installer.blocking && (
        <BlockingProcessesModal
          onDismiss={installer.dismissBlocking}
          onKillAndRetry={installer.killBlockingAndRetry}
          onRetry={installer.retryBlocking}
          state={installer.blocking}
        />
      )}
    </Layout>
  );

  async function loadAccount(activeSession: AuthSession) {
    setAccountLoading(true);
    setChannelError(null);
    try {
      const [nextProfile, nextKeys] = await Promise.all([
        getUserProfile(activeSession),
        listApiKeys(activeSession),
      ]);
      setProfile(nextProfile);
      setApiKeys(nextKeys.filter((key) => key.status === "active"));
    } catch (e) {
      setChannelError(normalizeError(e));
    } finally {
      setAccountLoading(false);
    }
  }
}

function createDefaultChannel(): ChannelConfig {
  const root = PUBLIC_BASE_URL.replace(/\/+$/, "");
  return {
    id: "default",
    name: "芝麻灵码",
    toolConfigs: {
      claude: { baseUrl: `${root}/v1`, apiKey: "" },
      codex: { baseUrl: `${root}/v1`, apiKey: "" },
      gemini: { baseUrl: `${root}/v1beta`, apiKey: "" },
      opencode: { baseUrl: `${root}/v1`, apiKey: "" },
    },
    isDefault: true,
  };
}

function mergeDefaultChannel(channels: ChannelConfig[]) {
  const defaultChannel = createDefaultChannel();
  const custom = channels.filter((channel) => channel.id !== "default").map(normalizeChannel);
  return [defaultChannel, ...custom];
}

function normalizeChannels(channels: ChannelConfig[]) {
  return channels.map(normalizeChannel).filter((channel) => channel.id !== "default");
}

function normalizeChannel(channel: ChannelConfig): ChannelConfig {
  const legacy = channel as ChannelConfig & {
    claudeBaseUrl?: string;
    codexBaseUrl?: string;
    geminiBaseUrl?: string;
    apiKey?: string;
  };

  return {
    id: channel.id || `custom-${Date.now()}`,
    name: channel.name || "自定义渠道",
    isDefault: channel.isDefault,
    toolConfigs: {
      ...DEFAULT_TOOL_CONFIGS,
      ...(channel.toolConfigs ?? {}),
      claude: {
        baseUrl: channel.toolConfigs?.claude?.baseUrl ?? legacy.claudeBaseUrl ?? "",
        apiKey: channel.toolConfigs?.claude?.apiKey ?? legacy.apiKey ?? "",
      },
      codex: {
        baseUrl: channel.toolConfigs?.codex?.baseUrl ?? legacy.codexBaseUrl ?? "",
        apiKey: channel.toolConfigs?.codex?.apiKey ?? legacy.apiKey ?? "",
      },
      gemini: {
        baseUrl: channel.toolConfigs?.gemini?.baseUrl ?? legacy.geminiBaseUrl ?? "",
        apiKey: channel.toolConfigs?.gemini?.apiKey ?? legacy.apiKey ?? "",
      },
      opencode: {
        baseUrl: channel.toolConfigs?.opencode?.baseUrl ?? legacy.codexBaseUrl ?? "",
        apiKey: channel.toolConfigs?.opencode?.apiKey ?? legacy.apiKey ?? "",
      },
    },
  };
}

function upsertChannel(channels: ChannelConfig[], channel: ChannelConfig) {
  const current = normalizeChannels(channels);
  const index = current.findIndex((item) => item.id === channel.id);
  if (index === -1) return [...current, channel];
  return current.map((item) => (item.id === channel.id ? channel : item));
}

function resolveToolConfig(
  channel: ChannelConfig,
  apiKeys: ApiKey[],
  selections: ToolKeySelections,
  tool: AiToolId,
): ToolChannelConfig | null {
  const base = channel.toolConfigs[tool];
  if (!base?.baseUrl) return null;

  if (!channel.isDefault) {
    return base.apiKey ? base : null;
  }

  const matching = keysForTool(apiKeys, tool);
  const selected = matching.find((key) => key.id === selections[tool]) ?? matching[0];
  if (!selected) return null;
  return { baseUrl: base.baseUrl, apiKey: selected.key };
}

function envVarsForTool(tool: AiToolId, config: ToolChannelConfig) {
  if (tool === "claude") {
    return [
      { name: "ANTHROPIC_API_KEY", value: config.apiKey },
      { name: "ANTHROPIC_AUTH_TOKEN", value: config.apiKey },
      { name: "ANTHROPIC_BASE_URL", value: config.baseUrl },
    ];
  }
  if (tool === "gemini") {
    return [
      { name: "GEMINI_API_KEY", value: config.apiKey },
      { name: "GOOGLE_GEMINI_BASE_URL", value: config.baseUrl },
      { name: "GEMINI_MODEL", value: "gemini-2.0-flash" },
    ];
  }
  return [
    { name: "OPENAI_API_KEY", value: config.apiKey },
    { name: "OPENAI_BASE_URL", value: config.baseUrl },
  ];
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/, "") || "请求失败";
}

export default App;
