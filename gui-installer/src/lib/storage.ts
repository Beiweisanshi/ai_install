import { invoke } from "@tauri-apps/api/core";

import type { ActiveSettings, AuthSession, ChannelConfig, DetectResult, ToolKeySelections } from "../types";

const SESSION_KEY = "zm_tools_auth_session";
const API_KEY_KEY = "zm_tools_selected_api_key";
const TOOL_KEY_SELECTIONS_KEY = "zm_tools_tool_key_selections";
const CHANNELS_KEY = "zm_tools_channels";
const CURRENT_CHANNEL_KEY = "zm_tools_current_channel";
const DETECT_CACHE_KEY = "zm_tools_detect_cache";
const PREFERENCES_KEY = "zm_tools_preferences";

export interface Preferences {
  darkMode: boolean;
  rememberLogin: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  darkMode: false,
  rememberLogin: true,
};

export async function loadSession(): Promise<AuthSession | null> {
  const transient = readSessionFromSessionStorage();
  const secure = transient ? null : (isTauriRuntime()
    ? parseSession(await invoke<string | null>("secure_session_get"))
    : null);
  const legacy = transient || secure ? null : readSessionFromLocalStorage();
  const session = transient ?? secure ?? legacy;

  if (!session) return null;

  if (session.expires_at && session.expires_at <= Date.now()) {
    await clearSession();
    return null;
  }

  if (legacy) {
    await saveSession(legacy, true);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }

  return session;
}

export async function saveSession(session: AuthSession, remember = true) {
  localStorage.removeItem(SESSION_KEY);
  const payload = JSON.stringify(session);
  if (remember && isTauriRuntime()) {
    sessionStorage.removeItem(SESSION_KEY);
    await invoke("secure_session_set", { session: payload });
    return;
  }
  if (isTauriRuntime()) {
    await invoke("secure_session_clear");
  }
  sessionStorage.setItem(SESSION_KEY, payload);
}

export async function clearSession() {
  if (isTauriRuntime()) {
    await invoke("secure_session_clear");
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(API_KEY_KEY);
}

export function loadToolKeySelections(): ToolKeySelections {
  return readJson<ToolKeySelections>(TOOL_KEY_SELECTIONS_KEY) ?? {};
}

export function saveToolKeySelections(selections: ToolKeySelections) {
  localStorage.setItem(TOOL_KEY_SELECTIONS_KEY, JSON.stringify(selections));
}

export function loadChannels(): ChannelConfig[] {
  return readJson<ChannelConfig[]>(CHANNELS_KEY) ?? [];
}

// UI cache only — disk persistence happens via applyActiveChannel.
export function saveChannels(channels: ChannelConfig[]) {
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
}

export async function applyActiveChannel(channel: ChannelConfig): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("apply_active_channel", { channel });
}

export async function readActiveSettings(): Promise<ActiveSettings | null> {
  if (!isTauriRuntime()) return null;
  return invoke<ActiveSettings>("read_active_settings");
}

export function loadCurrentChannelId(): string | null {
  return localStorage.getItem(CURRENT_CHANNEL_KEY);
}

export function saveCurrentChannelId(id: string) {
  localStorage.setItem(CURRENT_CHANNEL_KEY, id);
}

export function loadDetectCache(): DetectResult[] | null {
  const cached = readJson<{ tools: DetectResult[]; savedAt: number }>(DETECT_CACHE_KEY);
  return cached?.tools ?? null;
}

export function saveDetectCache(tools: DetectResult[]) {
  localStorage.setItem(DETECT_CACHE_KEY, JSON.stringify({ tools, savedAt: Date.now() }));
}

export function loadPreferences(): Preferences {
  return { ...DEFAULT_PREFERENCES, ...(readJson<Partial<Preferences>>(PREFERENCES_KEY) ?? {}) };
}

export function savePreferences(preferences: Preferences) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function readSessionFromSessionStorage(): AuthSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return parseSession(raw);
}

function readSessionFromLocalStorage(): AuthSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return parseSession(raw);
}

function parseSession(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
