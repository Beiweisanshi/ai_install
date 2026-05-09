import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import AuthPanel from "./components/AuthPanel";
import BlockingProcessesModal from "./components/BlockingProcessesModal";
import CcSwitchConflictDialog from "./components/CcSwitchConflictDialog";
import Dashboard from "./components/Dashboard";
import DetectSkeleton from "./components/DetectSkeleton";
import Layout from "./components/Layout";
import PreflightDialog from "./components/PreflightDialog";
import Summary from "./components/Summary";
import Toast, { type ToastKind } from "./components/Toast";
import ToolList from "./components/ToolList";
import {
  getPaymentCheckoutInfo,
  getUserProfile,
  listApiKeys,
  PUBLIC_BASE_URL,
} from "./lib/backendApi";
import {
  applyActiveChannelWithPrecheck,
  closeCcSwitch,
  clearSession,
  loadChannels,
  loadCurrentChannelId,
  loadPreferences,
  loadSession,
  loadToolKeySelections,
  matchActiveSettingsToChannel,
  pushRecentCwd,
  readActiveSettings,
  saveChannels,
  saveCurrentChannelId,
  savePreferences,
  saveSession,
  saveToolKeySelections,
} from "./lib/storage";
import { formatText, t } from "./lib/strings";
import { DEFAULT_TOOL_CONFIGS, keysForTool, TOOL_IDS } from "./lib/toolKeys";
import { useInstaller } from "./hooks/useInstaller";
import { useSmoothedProgress } from "./hooks/useSmoothedProgress";
import type {
  ActiveSettings,
  AiToolId,
  ApiKey,
  AppPhase,
  AuthSession,
  ChannelConfig,
  ToolChannelConfig,
  ToolKeySelections,
  UserProfile,
} from "./types";

function App() {
  const installer = useInstaller();
  const smoothedProgress = useSmoothedProgress(installer.progress);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [keySelections, setKeySelections] = useState<ToolKeySelections>(() => loadToolKeySelections());
  const [channels, setChannels] = useState<ChannelConfig[]>(() => normalizeChannels(loadChannels()));
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(() => loadCurrentChannelId());
  const [channelError, setChannelError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: ToastKind; text: string } | null>(null);
  const [preferences, setPreferences] = useState(() => loadPreferences());
  const [ccSwitchConflict, setCcSwitchConflict] = useState<{
    procs: { pid: number; name: string }[];
    pendingChannel: ChannelConfig;
    closing: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSession()
      .then((storedSession) => {
        if (!cancelled) setSession(storedSession);
      })
      .catch((error) => {
        if (!cancelled) setChannelError(normalizeError(error));
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveChannels(channels);
  }, [channels]);

  useEffect(() => {
    if (!session) return;
    void loadAccount(session);
  }, [session]);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.darkMode ? "dark" : "light";
    savePreferences(preferences);
  }, [preferences]);

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

  // Subscribe to fs-watcher emissions; suppressed for ~1.5s after our own writes.
  // Use a ref so editing channels (renaming, key changes, etc.) doesn't tear
  // down and re-create the listener.
  const channelsRef = useRef(effectiveChannels);
  channelsRef.current = effectiveChannels;
  const currentChannelIdRef = useRef(currentChannelId);
  currentChannelIdRef.current = currentChannelId;

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    const apply = (settings: ActiveSettings | null) => {
      const match = matchActiveSettingsToChannel(settings, channelsRef.current);
      if (match.channelId) {
        if (match.channelId !== currentChannelIdRef.current) {
          setCurrentChannelId(match.channelId);
          saveCurrentChannelId(match.channelId);
        }
      } else if (match.isExternal) {
        setToast({ kind: "err", text: t("channel.externalDetected") });
      }
    };

    void readActiveSettings()
      .then((settings) => { if (!cancelled) apply(settings); })
      .catch(() => {});

    void listen<ActiveSettings>("live-config-changed", (event) => {
      if (cancelled) return;
      apply(event.payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const gatedPhase: AppPhase = installer.phase === "dashboard"
    ? sessionLoading
      ? "detecting"
      : !session
      ? "auth"
      : "dashboard"
    : installer.phase;

  const handleAuthenticated = async (nextSession: AuthSession) => {
    await saveSession(nextSession, preferences.rememberLogin);
    setSession(nextSession);
  };

  const handleLogout = async () => {
    await clearSession();
    setSession(null);
    setApiKeys([]);
    setProfile(null);
  };

  // Try to activate a channel. Writes live config files unless cc-switch is
  // detected, in which case it surfaces the conflict dialog and lets the user
  // decide. Returns true on apply success, false on conflict pending or error.
  const tryActivateChannel = useCallback(
    async (channel: ChannelConfig, force = false): Promise<boolean> => {
      try {
        const result = await applyActiveChannelWithPrecheck(channel, force);
        if (result.status === "ccSwitchRunning") {
          setCcSwitchConflict({
            procs: result.procs,
            pendingChannel: channel,
            closing: false,
          });
          return false;
        }
        if (channel.id !== currentChannelIdRef.current) {
          setCurrentChannelId(channel.id);
          saveCurrentChannelId(channel.id);
        }
        setToast({ kind: "ok", text: t("channel.applied") });
        return true;
      } catch (e) {
        setToast({ kind: "err", text: formatText("channel.applyFailed", { detail: normalizeError(e) }) });
        return false;
      }
    },
    [],
  );

  const handleSaveChannel = async (channel: ChannelConfig) => {
    const normalized = normalizeChannel(channel);
    const next = upsertChannel(channels, normalized);
    setChannels(next);
    await tryActivateChannel(normalized);
  };

  const handleSwitchChannel = async (id: string) => {
    const target = effectiveChannels.find((channel) => channel.id === id);
    if (!target) return;
    await tryActivateChannel(target);
  };

  const handleCcSwitchDecision = useCallback(
    async (decision: "close" | "force" | "cancel") => {
      const conflict = ccSwitchConflict;
      if (!conflict) return;
      if (decision === "cancel") {
        setCcSwitchConflict(null);
        return;
      }
      if (decision === "force") {
        setCcSwitchConflict(null);
        await tryActivateChannel(conflict.pendingChannel, true);
        return;
      }
      // decision === "close"
      const pids = conflict.procs.map((p) => p.pid);
      setCcSwitchConflict({ ...conflict, closing: true });
      try {
        await closeCcSwitch(pids, false);
      } catch (e) {
        setToast({ kind: "err", text: formatText("channel.ccSwitchCloseFailed", { detail: normalizeError(e) }) });
        setCcSwitchConflict({ ...conflict, closing: false });
        return;
      }
      setCcSwitchConflict(null);
      await tryActivateChannel(conflict.pendingChannel);
    },
    [ccSwitchConflict, tryActivateChannel],
  );

  const handleDeleteChannel = (id: string) => {
    const channel = channels.find((item) => item.id === id);
    if (!channel || channel.isDefault) return;
    const next = channels.filter((item) => item.id !== id);
    setChannels(next);
    if (currentChannelId === id) {
      setCurrentChannelId("default");
      saveCurrentChannelId("default");
    }
  };

  const handleSelectToolKey = (tool: AiToolId, keyId: number) => {
    const next = { ...keySelections, [tool]: keyId };
    setKeySelections(next);
    saveToolKeySelections(next);
  };

  const handleRememberLoginChange = (rememberLogin: boolean) => {
    setPreferences((current) => ({ ...current, rememberLogin }));
    if (!rememberLogin) {
      void clearSession();
    } else if (session) {
      void saveSession(session, true);
    }
  };

  const dismissToast = useCallback(() => setToast(null), []);

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
        setChannelError(t("dashboard.noRecharge"));
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

  const openKeyManager = async () => {
    const url = `${PUBLIC_BASE_URL}/keys`;
    try {
      await invoke("open_external_url", { url });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const launchTool = async (tool: AiToolId, modeId: string, cwd: string | null) => {
    const resolved = resolveToolConfig(currentChannel, apiKeys, keySelections, tool);
    if (!resolved) {
      setChannelError(currentChannel.isDefault ? t("dashboard.noMatchingKeyError") : t("dashboard.incompleteCustomChannel"));
      return;
    }

    setChannelError(null);
    try {
      await invoke("launch_ai_tool", {
        tool,
        mode: modeId,
        cwd,
        envVars: envVarsForTool(tool, resolved),
      });
      if (cwd) pushRecentCwd(cwd);
    } catch (e) {
      setChannelError(normalizeError(e));
    }
  };

  return (
    <Layout
      appVersionInfo={installer.appVersionInfo}
      darkMode={preferences.darkMode}
      onToggleDarkMode={() => setPreferences((current) => ({ ...current, darkMode: !current.darkMode }))}
    >
      {gatedPhase === "detecting" && (
        <DetectSkeleton tools={["Git", "Node.js", "Nushell", "Codex", "Claude", "Gemini", "OpenCode"]} />
      )}

      {gatedPhase === "auth" && (
        <AuthPanel
          onAuthenticated={handleAuthenticated}
          onRememberLoginChange={handleRememberLoginChange}
          rememberLogin={preferences.rememberLogin}
        />
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
          onDeleteChannel={handleDeleteChannel}
          onOpenKeyManager={openKeyManager}
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
          appVersionInfo={installer.appVersionInfo}
          darkMode={preferences.darkMode}
          rememberLogin={preferences.rememberLogin}
          onDarkModeChange={(darkMode) => setPreferences((current) => ({ ...current, darkMode }))}
          onRememberLoginChange={handleRememberLoginChange}
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
        <Summary
          onDone={() => {
            installer.goDashboard();
            if (session) {
              void loadAccount(session);
            }
          }}
          onRetry={installer.retryFailed}
          results={installer.results}
          tools={installer.tools}
        />
      )}

      {installer.preflight && (
        <PreflightDialog
          onCancel={installer.cancelPreflight}
          onConfirm={installer.confirmPreflight}
          result={installer.preflight.result}
          tools={installer.preflight.tools}
        />
      )}

      {installer.blocking && (
        <BlockingProcessesModal
          onDismiss={installer.dismissBlocking}
          onKillAndRetry={installer.killBlockingAndRetry}
          onRetry={installer.retryBlocking}
          state={installer.blocking}
        />
      )}

      {toast && <Toast kind={toast.kind} text={toast.text} onDismiss={dismissToast} />}

      {ccSwitchConflict && (
        <CcSwitchConflictDialog
          procs={ccSwitchConflict.procs}
          closing={ccSwitchConflict.closing}
          onDecision={handleCcSwitchDecision}
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
    name: t("app.defaultChannelName"),
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
    name: channel.name || t("app.customChannelName"),
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
  return message.replace(/^Error:\s*/, "") || t("app.error.requestFailed");
}

export default App;
