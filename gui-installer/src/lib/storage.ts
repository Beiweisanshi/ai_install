import type { AuthSession, ChannelConfig, DetectResult, ToolKeySelections } from "../types";

const SESSION_KEY = "zm_tools_auth_session";
const API_KEY_KEY = "zm_tools_selected_api_key";
const TOOL_KEY_SELECTIONS_KEY = "zm_tools_tool_key_selections";
const CHANNELS_KEY = "zm_tools_channels";
const CURRENT_CHANNEL_KEY = "zm_tools_current_channel";
const DETECT_CACHE_KEY = "zm_tools_detect_cache";

export function loadSession(): AuthSession | null {
  return readJson<AuthSession>(SESSION_KEY);
}

export function saveSession(session: AuthSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
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

export function saveChannels(channels: ChannelConfig[]) {
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
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
