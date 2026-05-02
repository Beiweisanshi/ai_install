import type { AiToolId, ApiKey, ToolChannelConfigs } from "../types";

export const TOOL_IDS: AiToolId[] = ["codex", "claude", "gemini", "opencode"];

export const DEFAULT_TOOL_CONFIGS: ToolChannelConfigs = {
  claude: { baseUrl: "", apiKey: "" },
  codex: { baseUrl: "", apiKey: "" },
  gemini: { baseUrl: "", apiKey: "" },
  opencode: { baseUrl: "", apiKey: "" },
};

export function platformForTool(tool: AiToolId) {
  if (tool === "claude") return "anthropic";
  if (tool === "gemini") return "gemini";
  return "openai";
}

export function keysForTool(keys: ApiKey[], tool: AiToolId) {
  const platform = platformForTool(tool);
  return keys.filter((key) => key.status === "active" && key.group?.platform === platform);
}

export function maskKey(key: string) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

export function toolNameForConfig(tool: AiToolId) {
  if (tool === "claude") return "Claude CLI";
  if (tool === "gemini") return "Gemini CLI";
  if (tool === "opencode") return "OpenCode";
  return "Codex CLI";
}
