import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

import { formatText, t } from "../lib/strings";
import { maskKey, toolNameForConfig } from "../lib/toolKeys";
import { theme } from "../styles/theme";
import { closeOnBackdropMouseDown, useDialogKeyboard } from "../hooks/useDialogKeyboard";
import type { AiToolId, AppVersionInfo, ChannelConfig, EnvVarInfo } from "../types";

interface SettingsDrawerProps {
  channels: ChannelConfig[];
  currentChannelId: string;
  appVersionInfo: AppVersionInfo | null;
  darkMode: boolean;
  rememberLogin: boolean;
  detectInterval: number;
  onClose: () => void;
  onNewChannel: () => void;
  onEditChannel: (channel: ChannelConfig) => void;
  onDeleteChannel: (id: string) => void;
  onSwitchChannel: (id: string) => void;
  onDarkModeChange: (enabled: boolean) => void;
  onRememberLoginChange: (enabled: boolean) => void;
  onDetectIntervalChange: (seconds: number) => void;
}

function SettingsDrawer({
  channels,
  currentChannelId,
  appVersionInfo,
  darkMode,
  rememberLogin,
  detectInterval,
  onClose,
  onNewChannel,
  onEditChannel,
  onDeleteChannel,
  onSwitchChannel,
  onDarkModeChange,
  onRememberLoginChange,
  onDetectIntervalChange,
}: SettingsDrawerProps) {
  const ref = useDialogKeyboard<HTMLDivElement>(true, onClose);
  const [envVars, setEnvVars] = useState<EnvVarInfo[]>([]);
  const [logsDir, setLogsDir] = useState("");

  useEffect(() => {
    void refreshEnvVars();
    invoke<string>("logs_dir").then(setLogsDir).catch(() => setLogsDir("%LOCALAPPDATA%\\gui-installer\\logs"));
  }, []);

  async function refreshEnvVars() {
    try {
      setEnvVars(await invoke<EnvVarInfo[]>("list_managed_env_vars"));
    } catch {
      setEnvVars([]);
    }
  }

  async function clearEnvVar(name: string) {
    await invoke("clear_managed_env_var", { name });
    await refreshEnvVars();
  }

  async function openLogsDir() {
    if (!logsDir) return;
    await invoke("open_path", { path: logsDir });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/45" onMouseDown={closeOnBackdropMouseDown(onClose)}>
      <aside
        className="h-full w-[420px] max-w-[92vw] overflow-y-auto border-l p-5"
        ref={ref}
        role="dialog"
        aria-modal="true"
        style={{ background: theme.card, borderColor: theme.cardBorder, color: theme.textPrimary }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
          <button className="btn btn-text rounded-lg px-2 py-1 text-sm" onClick={onClose} style={{ color: theme.textSecondary }} type="button">
            {t("common.close")}
          </button>
        </div>

        <SettingsSection title={t("settings.channelManagement")}>
          <div className="grid gap-2">
            {channels.map((channel) => {
              const isActive = currentChannelId === channel.id;
              return (
                <div
                  className="rounded-lg border p-3"
                  key={channel.id}
                  style={{
                    borderColor: isActive ? theme.accent : theme.border,
                    borderLeftWidth: isActive ? 3 : 1,
                    background: isActive ? theme.accentLight : "transparent",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <span>{channel.name}</span>
                        {isActive && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ background: theme.accent, color: theme.textOnAccent }}
                          >
                            ● Active
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                        {channel.isDefault ? t("settings.defaultChannel") : summarizeChannel(channel)}
                      </div>
                    </div>
                    <input
                      checked={isActive}
                      onChange={() => onSwitchChannel(channel.id)}
                      type="radio"
                      style={{ cursor: "pointer" }}
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    {!channel.isDefault && (
                      <>
                        <button className="btn btn-secondary rounded-md px-2 py-1 text-xs" onClick={() => onEditChannel(channel)} type="button">
                          {t("common.edit")}
                        </button>
                        <button className="btn btn-danger rounded-md px-2 py-1 text-xs" onClick={() => onDeleteChannel(channel.id)} style={{ background: theme.errorLight, color: theme.error }} type="button">
                          {t("common.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn btn-primary mt-3 rounded-lg px-3 py-2 text-sm font-semibold" onClick={onNewChannel} style={{ background: theme.accent, color: theme.textOnAccent }} type="button">
            {t("settings.newChannel")}
          </button>
        </SettingsSection>

        <SettingsSection title={t("settings.envVars")}>
          <div className="grid gap-2">
            {envVars.map((item) => (
              <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" key={item.name} style={{ background: theme.bgTertiary }}>
                <div className="min-w-0">
                  <div className="font-mono text-xs" style={{ color: theme.textPrimary }}>{item.name}</div>
                  <div className="truncate text-xs" style={{ color: theme.textMuted }}>
                    {item.value ? maskEnvValue(item.value) : t("settings.notSet")}
                  </div>
                </div>
                <button
                  className="btn btn-danger shrink-0 rounded-md px-2 py-1 text-xs disabled:opacity-40"
                  disabled={!item.value}
                  onClick={() => void clearEnvVar(item.name)}
                  style={{ background: theme.errorLight, color: theme.error }}
                  type="button"
                >
                  {t("settings.clear")}
                </button>
              </div>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection title={t("settings.logsDir")}>
          <div className="rounded-lg px-3 py-2 font-mono text-xs" style={{ background: theme.bgTertiary, color: theme.textSecondary }}>
            {logsDir || "%LOCALAPPDATA%\\gui-installer\\logs"}
          </div>
          <button className="btn btn-secondary mt-2 rounded-lg px-3 py-2 text-sm" onClick={() => void openLogsDir()} type="button">
            {t("settings.openDir")}
          </button>
        </SettingsSection>

        <SettingsSection title={t("settings.preferences")}>
          <Toggle label={t("settings.darkMode")} checked={darkMode} onChange={onDarkModeChange} />
          <Toggle label={t("settings.rememberLogin")} checked={rememberLogin} onChange={onRememberLoginChange} />
          <label className="mt-3 grid gap-1.5 text-sm" style={{ color: theme.textSecondary }}>
            {t("settings.detectInterval")}
            <input
              className="rounded-lg border px-3 py-2"
              min={10}
              max={3600}
              onChange={(event) => onDetectIntervalChange(Number(event.target.value))}
              style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
              type="number"
              value={detectInterval}
            />
          </label>
        </SettingsSection>

        <SettingsSection title={t("settings.about")}>
          <div className="text-sm" style={{ color: theme.textSecondary }}>
            {formatText("settings.currentVersion", { version: appVersionInfo?.current_version ?? "0.1.0" })}
          </div>
          {(appVersionInfo?.release_url || appVersionInfo?.download_url) && (
            <button
              className="btn btn-secondary mt-2 rounded-lg px-3 py-2 text-sm"
              onClick={() => void invoke("open_external_url", { url: appVersionInfo.release_url || appVersionInfo.download_url })}
              type="button"
            >
              {t("settings.releaseNotes")}
            </button>
          )}
        </SettingsSection>
      </aside>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-sm font-semibold" style={{ color: theme.textPrimary }}>{title}</h3>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2 text-sm" style={{ color: theme.textSecondary }}>
      {label}
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function summarizeChannel(channel: ChannelConfig) {
  const configured = (Object.keys(channel.toolConfigs) as AiToolId[])
    .filter((tool) => channel.toolConfigs[tool]?.baseUrl || channel.toolConfigs[tool]?.apiKey)
    .map(toolNameForConfig);
  return configured.length > 0 ? configured.join(" / ") : t("common.unconfigured");
}

function maskEnvValue(value: string) {
  if (value.length <= 10) return maskKey(value);
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default SettingsDrawer;
