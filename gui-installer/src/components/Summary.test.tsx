import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Summary from "./Summary";
import type { DetectResult, InstallResult } from "../types";

const results: InstallResult[] = [
  { name: "Claude Code", success: true, version: "1.0.0", message: "Installed successfully", duration_ms: 800 },
  { name: "Codex", success: true, version: "1.1.0", message: "Updated successfully", duration_ms: 1500 },
  { name: "Gemini", success: false, version: null, message: "Network error", duration_ms: 500 },
  { name: "CC-Switch", success: false, version: "0.9.0", message: "skip existing install", duration_ms: 200 },
];

const tools: DetectResult[] = [
  { name: "Claude Code", installed: true, current_version: "1.0.0", available_version: "1.0.0", upgradable: false, installable: true, unavailable_reason: null },
  { name: "Codex", installed: true, current_version: "1.1.0", available_version: "1.2.0", upgradable: true, installable: true, unavailable_reason: null },
  { name: "Gemini", installed: false, current_version: null, available_version: null, upgradable: false, installable: true, unavailable_reason: null },
  { name: "CC-Switch", installed: true, current_version: "0.9.0", available_version: "1.0.0", upgradable: true, installable: true, unavailable_reason: null },
];

describe("Summary", () => {
  it("renders the installation summary", () => {
    render(<Summary results={results} tools={tools} />);

    expect(screen.getByText("安装结果")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.getByText("CC-Switch")).toBeInTheDocument();
  });

  it("shows success, failed, and skipped counts", () => {
    render(<Summary results={results} tools={tools} />);

    expect(screen.getByText("成功 2 / 失败 1 / 跳过 1")).toBeInTheDocument();
  });
});
