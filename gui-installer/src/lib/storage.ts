import { invoke } from "@tauri-apps/api/core";

import type { ActiveSettings, AiToolId, AuthSession, ChannelConfig, DetectResult, ToolKeySelections } from "../types";

const SESSION_KEY = "zm_tools_auth_session";
const API_KEY_KEY = "zm_tools_selected_api_key";
const TOOL_KEY_SELECTIONS_KEY = "zm_tools_tool_key_selections";
const CHANNELS_KEY = "zm_tools_channels";
const CURRENT_CHANNEL_KEY = "zm_tools_current_channel";
const DETECT_CACHE_KEY = "zm_tools_detect_cache";
const PREFERENCES_KEY = "zm_tools_preferences";
const RECENT_CWDS_KEY = "zm_tools_recent_cwds";
const RECENT_CWDS_MAX = 5;
const LAST_CONFIRMED_LAUNCH_KEY = "zm_tools_last_confirmed_launch";

const KNOWN_TOOL_IDS: ReadonlyArray<AiToolId> = ["codex", "claude", "gemini", "opencode"];

export interface LastConfirmedLaunch {
  modeId: string;
  cwd: string | null;
}

export type LastConfirmedLaunchMap = Partial<Record<AiToolId, LastConfirmedLaunch>>;

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

// UI cache only — disk persistence happens via applyActiveChannelWithPrecheck.
export function saveChannels(channels: ChannelConfig[]) {
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
}

export interface CcSwitchProc {
  pid: number;
  name: string;
}

export type ApplyChannelOutcome =
  | { status: "applied" }
  | { status: "ccSwitchRunning"; procs: CcSwitchProc[] };

// Returns ccSwitchRunning without writing live files when force=false.
export async function applyActiveChannelWithPrecheck(
  channel: ChannelConfig,
  force = false,
): Promise<ApplyChannelOutcome> {
  if (!isTauriRuntime()) return { status: "applied" };
  return invoke<ApplyChannelOutcome>("apply_active_channel_with_precheck", { channel, force });
}

export async function closeCcSwitch(pids: number[], force: boolean): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return invoke<number>("cc_switch_close", { pids, force });
}

export async function readActiveSettings(): Promise<ActiveSettings | null> {
  if (!isTauriRuntime()) return null;
  return invoke<ActiveSettings>("read_active_settings");
}

export interface MatchResult {
  channelId: string | null;
  isExternal: boolean;
}

// Compare the on-disk live config snapshot against each saved channel's
// toolConfigs and return the first channel that fully matches. If nothing
// matches, isExternal is true so the UI can surface a "live config does not
// belong to any saved channel" affordance. A channel matches only if every
// (baseUrl, apiKey) pair lines up — empty pairs on both sides are
// considered equal, but a populated pair on either side requires the other
// side to also be populated and identical.
export function matchActiveSettingsToChannel(
  active: ActiveSettings | null,
  channels: ChannelConfig[],
): MatchResult {
  if (!active) return { channelId: null, isExternal: false };
  for (const channel of channels) {
    if (channelMatchesActive(channel, active)) {
      return { channelId: channel.id, isExternal: false };
    }
  }
  return { channelId: null, isExternal: true };
}

function channelMatchesActive(channel: ChannelConfig, active: ActiveSettings): boolean {
  const c = channel.toolConfigs;
  if (!matchesPair(c.claude, active.claudeBaseUrl, active.claudeAuthToken ?? active.claudeApiKey)) return false;
  if (!matchesPair(c.codex, active.codexBaseUrl, active.codexApiKey)) return false;
  if (!matchesPair(c.gemini, active.geminiBaseUrl, active.geminiApiKey)) return false;
  return true;
}

function matchesPair(
  cfg: { baseUrl: string; apiKey: string },
  diskUrl: string | null,
  diskKey: string | null,
): boolean {
  const cfgEmpty = !cfg.baseUrl && !cfg.apiKey;
  const diskEmpty = !diskUrl && !diskKey;
  if (cfgEmpty && diskEmpty) return true;
  if (cfgEmpty || diskEmpty) return false;
  return cfg.baseUrl === diskUrl && cfg.apiKey === diskKey;
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

export function loadRecentCwds(): string[] {
  const raw = readJson<unknown>(RECENT_CWDS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, RECENT_CWDS_MAX);
}

export function saveRecentCwds(list: string[]) {
  localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify(list.slice(0, RECENT_CWDS_MAX)));
}

// MRU-push the given path to the front of the recent-cwds list.
// - Empty / nullish input is ignored (returns the existing list unchanged).
// - Comparison is case-insensitive (Windows paths) but we keep the original
//   casing of the FIRST occurrence — i.e. an existing entry is moved to the
//   front, the incoming path's casing is not used to overwrite it.
// - Capped at RECENT_CWDS_MAX entries.
export function pushRecentCwd(path: string | null | undefined): string[] {
  const trimmed = typeof path === "string" ? path.trim() : "";
  if (!trimmed) return loadRecentCwds();

  const current = loadRecentCwds();
  const lower = trimmed.toLowerCase();
  const existingIndex = current.findIndex((entry) => entry.toLowerCase() === lower);
  const head = existingIndex >= 0 ? current[existingIndex] : trimmed;
  const rest = existingIndex >= 0
    ? [...current.slice(0, existingIndex), ...current.slice(existingIndex + 1)]
    : current;
  const next = [head, ...rest].slice(0, RECENT_CWDS_MAX);
  saveRecentCwds(next);
  return next;
}

// Per-tool persistence of "the last DangerConfirmDialog confirmation" so
// repeating an identical dangerous launch (same modeId + cwd) can skip the
// confirmation modal. Stored as a map keyed by AiToolId; entries are validated
// at load time so a corrupted/forged value is treated as "no record" → the
// confirmation modal still fires.
export function loadLastConfirmedLaunch(): LastConfirmedLaunchMap {
  const raw = readJson<unknown>(LAST_CONFIRMED_LAUNCH_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map = raw as Record<string, unknown>;
  const out: LastConfirmedLaunchMap = {};
  for (const toolId of KNOWN_TOOL_IDS) {
    const entry = map[toolId];
    if (!entry || typeof entry !== "object") continue;
    const v = entry as { modeId?: unknown; cwd?: unknown };
    if (typeof v.modeId !== "string") continue;
    if (v.cwd !== null && typeof v.cwd !== "string") continue;
    out[toolId] = { modeId: v.modeId, cwd: v.cwd };
  }
  return out;
}

export function saveLastConfirmedLaunch(tool: AiToolId, entry: LastConfirmedLaunch): void {
  const map = loadLastConfirmedLaunch();
  map[tool] = entry;
  localStorage.setItem(LAST_CONFIRMED_LAUNCH_KEY, JSON.stringify(map));
}

export function matchesLastConfirmedLaunch(
  tool: AiToolId,
  modeId: string,
  cwd: string | null,
): boolean {
  const entry = loadLastConfirmedLaunch()[tool];
  if (!entry) return false;
  return entry.modeId === modeId && entry.cwd === cwd;
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
