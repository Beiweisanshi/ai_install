import { describe, expect, it } from "vitest";

import {
  defaultModeId,
  findMode,
  getModes,
  LAUNCH_MODES,
  legacyAlias,
  previewCommand,
} from "./launchModes";
import type { AiToolId } from "../types";

const TOOL_IDS: AiToolId[] = ["codex", "claude", "gemini", "opencode"];

describe("launchModes catalog", () => {
  it.each([
    ["codex", ["codex.default", "codex.read-only", "codex.auto", "codex.dangerous"]],
    [
      "claude",
      [
        "claude.default",
        "claude.acceptEdits",
        "claude.plan",
        "claude.auto",
        "claude.dangerous",
      ],
    ],
    ["gemini", ["gemini.default", "gemini.plan", "gemini.auto-edit", "gemini.yolo"]],
    ["opencode", ["opencode.default", "opencode.allow-all"]],
  ])("exposes the expected mode ids for %s", (tool, expected) => {
    const ids = getModes(tool as AiToolId).map((mode) => mode.id);
    expect(ids).toEqual(expected);
  });

  it.each([
    ["codex", "codex.default"],
    ["claude", "claude.default"],
    ["gemini", "gemini.default"],
    ["opencode", "opencode.default"],
  ])("uses the first mode as the default for %s", (tool, expected) => {
    expect(defaultModeId(tool as AiToolId)).toBe(expected);
  });

  it("findMode returns the catalog entry by id and undefined for unknown ids", () => {
    expect(findMode("codex", "codex.read-only")?.id).toBe("codex.read-only");
    expect(findMode("codex", "nope")).toBeUndefined();
  });

  it("only codex and claude carry a dangerous mode", () => {
    const dangerous: Array<{ tool: AiToolId; id: string }> = [];
    for (const tool of TOOL_IDS) {
      for (const mode of LAUNCH_MODES[tool]) {
        if (mode.dangerLevel === "dangerous") {
          dangerous.push({ tool, id: mode.id });
        }
      }
    }
    expect(dangerous).toEqual([
      { tool: "codex", id: "codex.dangerous" },
      { tool: "claude", id: "claude.dangerous" },
    ]);
  });

  it("legacyAlias maps normal to the default id for every tool", () => {
    for (const tool of TOOL_IDS) {
      expect(legacyAlias(tool, "normal")).toBe(defaultModeId(tool));
    }
  });

  it("legacyAlias maps elevated to dangerous when present, otherwise the last caution mode", () => {
    expect(legacyAlias("codex", "elevated")).toBe("codex.dangerous");
    expect(legacyAlias("claude", "elevated")).toBe("claude.dangerous");
    expect(legacyAlias("gemini", "elevated")).toBe("gemini.yolo");
    expect(legacyAlias("opencode", "elevated")).toBe("opencode.allow-all");
  });

  it("previewCommand prefixes env lines and joins args with spaces", () => {
    const codexDefault = findMode("codex", "codex.default")!;
    expect(previewCommand(codexDefault)).toBe("codex");

    const codexAuto = findMode("codex", "codex.auto")!;
    expect(previewCommand(codexAuto)).toBe("codex -a never");

    const opencodeAllow = findMode("opencode", "opencode.allow-all")!;
    expect(previewCommand(opencodeAllow)).toBe("OPENCODE_PERMISSION=allow opencode");
  });

  it("each mode has a stable id of the form <tool>.<suffix>", () => {
    for (const tool of TOOL_IDS) {
      for (const mode of LAUNCH_MODES[tool]) {
        expect(mode.id.startsWith(`${tool}.`)).toBe(true);
      }
    }
  });
});
