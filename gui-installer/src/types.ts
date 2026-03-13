export interface DetectResult {
  name: string;
  installed: boolean;
  current_version: string | null;
  available_version: string | null;
  upgradable: boolean;
  installable: boolean;
  unavailable_reason: string | null;
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
