export interface DetectResult {
  name: string;
  installed: boolean;
  current_version: string | null;
  available_version: string | null;
  upgradable: boolean;
  installable: boolean;
  unavailable_reason: string | null;
  required: boolean;
  group: string;
}

export interface InstallResult {
  name: string;
  success: boolean;
  version: string | null;
  message: string;
  duration_ms: number;
}

export interface ProgressEvent {
  tool_name: string;
  stage: string;
  percent: number;
  message: string;
}

export interface ConfigEntry {
  tool_name: string;
  api_url?: string;
  api_key?: string;
}

export interface AppVersionInfo {
  current_version: string;
  latest_version: string | null;
  upgrade_available: boolean;
  download_url: string | null;
}

export interface RunningProc {
  pid: number;
  name: string;
  executable_path: string | null;
}

export interface BlockingState {
  toolName: string;
  pkg: string;
  processes: RunningProc[];
}

export type AppPhase =
  | "detecting"
  | "auth"
  | "dashboard"
  | "selecting"
  | "installing"
  | "summary";
export type LaunchMode = "normal" | "elevated";
export type AiToolId = "codex" | "claude" | "gemini" | "opencode";
export type GroupPlatform = "anthropic" | "openai" | "gemini" | "antigravity" | string;

export interface AiToolDefinition {
  id: AiToolId;
  name: string;
  detectName: string;
  normalCommand: string;
  elevatedCommand: string;
}

export interface UserInfo {
  id: number;
  email: string;
  username?: string;
}

export interface UserProfile extends UserInfo {
  balance: number;
}

export interface AuthSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
  user: UserInfo;
}

export interface PublicSettings {
  registration_enabled: boolean;
  email_verify_enabled: boolean;
  password_reset_enabled: boolean;
  invitation_code_enabled: boolean;
  promo_code_enabled: boolean;
  turnstile_enabled: boolean;
  turnstile_site_key: string;
  site_name: string;
  api_base_url: string;
}

export interface SendVerifyCodeResponse {
  message: string;
  countdown: number;
}

export interface ApiKey {
  id: number;
  user_id?: number;
  key: string;
  name: string;
  status: "active" | "inactive" | "quota_exhausted" | "expired";
  group_id: number | null;
  quota: number;
  quota_used: number;
  expires_at: string | null;
  created_at: string;
  updated_at?: string;
  group?: {
    id: number;
    name: string;
    platform: GroupPlatform;
    status?: string;
    rate_multiplier?: number;
  };
}

export interface ToolChannelConfig {
  baseUrl: string;
  apiKey: string;
}

export type ToolChannelConfigs = Record<AiToolId, ToolChannelConfig>;
export type ToolKeySelections = Partial<Record<AiToolId, number>>;

export interface PaymentCheckoutInfo {
  enabled?: boolean;
  payment_enabled?: boolean;
  balance_disabled?: boolean;
  methods?: string[];
}

export interface ChannelConfig {
  id: string;
  name: string;
  toolConfigs: ToolChannelConfigs;
  isDefault?: boolean;
}
