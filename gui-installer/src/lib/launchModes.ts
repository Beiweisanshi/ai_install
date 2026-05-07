// Launch-mode catalog — single source of truth on the TS side.
//
// Verified against codex 0.128.0 / claude 2.1.119 / gemini 0.39.1 / opencode 1.14.22.
// Notes from CLI --help inspection:
//   * codex 0.128: no `--full-auto` flag; auto-approval is `-a never` (sandbox still on).
//   * claude 2.1: `--permission-mode` accepts default/acceptEdits/plan/auto/bypassPermissions/dontAsk.
//                 `bypassPermissions` is semantically equivalent to `--dangerously-skip-permissions`,
//                 we expose only the latter as the dangerous lane.
//   * gemini 0.39: `--approval-mode {default,auto_edit,yolo,plan}`. Old `--yolo` still works
//                  but is superseded; this UI uses `--approval-mode yolo` exclusively.
//   * opencode 1.14: no permission flag; permissions are gated by the OPENCODE_PERMISSION env var.
//
// The Rust side mirrors this catalog in src-tauri/src/terminal.rs. If you change one side
// you must change the other — the resolve_mode tests enumerate all ids on both sides.
import type { AiToolId } from "../types";
import type { StringKey } from "./strings";

export type DangerLevel = "safe" | "caution" | "dangerous";

export interface EnvLine {
  name: string;
  value: string;
}

export interface LaunchModeDef {
  id: string;
  labelKey: StringKey;
  commandArgs: string[];
  envLines: EnvLine[];
  dangerLevel: DangerLevel;
}

export const LAUNCH_MODES: Record<AiToolId, LaunchModeDef[]> = {
  codex: [
    {
      id: "codex.default",
      labelKey: "dashboard.mode.codex.default",
      commandArgs: ["codex"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "codex.read-only",
      labelKey: "dashboard.mode.codex.read-only",
      commandArgs: ["codex", "-s", "read-only"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "codex.auto",
      labelKey: "dashboard.mode.codex.auto",
      commandArgs: ["codex", "-a", "never"],
      envLines: [],
      dangerLevel: "caution",
    },
    {
      id: "codex.dangerous",
      labelKey: "dashboard.mode.codex.dangerous",
      commandArgs: ["codex", "--dangerously-bypass-approvals-and-sandbox"],
      envLines: [],
      dangerLevel: "dangerous",
    },
  ],
  claude: [
    {
      id: "claude.default",
      labelKey: "dashboard.mode.claude.default",
      commandArgs: ["claude"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "claude.acceptEdits",
      labelKey: "dashboard.mode.claude.acceptEdits",
      commandArgs: ["claude", "--permission-mode", "acceptEdits"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "claude.plan",
      labelKey: "dashboard.mode.claude.plan",
      commandArgs: ["claude", "--permission-mode", "plan"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "claude.auto",
      labelKey: "dashboard.mode.claude.auto",
      commandArgs: ["claude", "--permission-mode", "auto"],
      envLines: [],
      dangerLevel: "caution",
    },
    {
      id: "claude.dangerous",
      labelKey: "dashboard.mode.claude.dangerous",
      commandArgs: ["claude", "--dangerously-skip-permissions"],
      envLines: [],
      dangerLevel: "dangerous",
    },
  ],
  gemini: [
    {
      id: "gemini.default",
      labelKey: "dashboard.mode.gemini.default",
      commandArgs: ["gemini"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "gemini.plan",
      labelKey: "dashboard.mode.gemini.plan",
      commandArgs: ["gemini", "--approval-mode", "plan"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "gemini.auto-edit",
      labelKey: "dashboard.mode.gemini.auto-edit",
      commandArgs: ["gemini", "--approval-mode", "auto_edit"],
      envLines: [],
      dangerLevel: "caution",
    },
    {
      id: "gemini.yolo",
      labelKey: "dashboard.mode.gemini.yolo",
      commandArgs: ["gemini", "--approval-mode", "yolo"],
      envLines: [],
      dangerLevel: "caution",
    },
  ],
  opencode: [
    {
      id: "opencode.default",
      labelKey: "dashboard.mode.opencode.default",
      commandArgs: ["opencode"],
      envLines: [],
      dangerLevel: "safe",
    },
    {
      id: "opencode.allow-all",
      labelKey: "dashboard.mode.opencode.allow-all",
      commandArgs: ["opencode"],
      envLines: [{ name: "OPENCODE_PERMISSION", value: "allow" }],
      dangerLevel: "caution",
    },
  ],
};

export function getModes(tool: AiToolId): LaunchModeDef[] {
  return LAUNCH_MODES[tool];
}

export function findMode(tool: AiToolId, modeId: string): LaunchModeDef | undefined {
  return LAUNCH_MODES[tool]?.find((mode) => mode.id === modeId);
}

export function defaultModeId(tool: AiToolId): string {
  return LAUNCH_MODES[tool][0].id;
}

// Map deprecated `mode='normal' | 'elevated'` payloads to the new id space.
// `elevated` resolves to the dangerous mode if the tool has one, otherwise the
// last caution mode (gemini → yolo, opencode → allow-all).
export function legacyAlias(tool: AiToolId, legacy: "normal" | "elevated"): string {
  if (legacy === "normal") return defaultModeId(tool);

  const modes = LAUNCH_MODES[tool];
  const dangerous = modes.find((mode) => mode.dangerLevel === "dangerous");
  if (dangerous) return dangerous.id;

  const cautions = modes.filter((mode) => mode.dangerLevel === "caution");
  if (cautions.length > 0) return cautions[cautions.length - 1].id;

  return defaultModeId(tool);
}

// UI-only command preview: env prefix + space-joined args. Not consumed by the
// launcher — Rust builds the actual script lines from its own catalog.
export function previewCommand(mode: LaunchModeDef): string {
  const envPrefix = mode.envLines.map((env) => `${env.name}=${env.value}`).join(" ");
  const command = mode.commandArgs.join(" ");
  return envPrefix ? `${envPrefix} ${command}` : command;
}
