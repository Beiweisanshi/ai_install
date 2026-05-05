import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Summary from "./Summary";
import type { DetectResult, InstallResult } from "../types";

const results: InstallResult[] = [
  { name: "Claude CLI", success: true, version: "1.0.0", message: "Installed successfully", duration_ms: 800 },
  { name: "Codex CLI", success: true, version: "1.1.0", message: "Updated successfully", duration_ms: 1500 },
  { name: "Gemini CLI", success: false, version: null, message: "Network error", duration_ms: 500 },
  { name: "OpenCode", success: false, version: "0.9.0", message: "skip existing install", duration_ms: 200 },
];

const tools: DetectResult[] = [
  { name: "Claude CLI", installed: true, current_version: "1.0.0", available_version: "1.0.0", upgradable: false, installable: true, unavailable_reason: null, required: false, group: "npm" },
  { name: "Codex CLI", installed: true, current_version: "1.1.0", available_version: "1.2.0", upgradable: true, installable: true, unavailable_reason: null, required: false, group: "npm" },
  { name: "Gemini CLI", installed: false, current_version: null, available_version: null, upgradable: false, installable: true, unavailable_reason: null, required: false, group: "npm" },
  { name: "OpenCode", installed: true, current_version: "0.9.0", available_version: "1.0.0", upgradable: true, installable: true, unavailable_reason: null, required: false, group: "npm" },
];

describe("Summary", () => {
  it("renders the installation summary", () => {
    render(<Summary onDone={() => undefined} onRetry={() => undefined} results={results} tools={tools} />);

    expect(screen.getByText("安装完成")).toBeInTheDocument();
    expect(screen.getByText("Claude CLI")).toBeInTheDocument();
    expect(screen.getByText("Codex CLI")).toBeInTheDocument();
    expect(screen.getByText("Gemini CLI")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
  });

  it("shows success, failed, and skipped counts", () => {
    render(<Summary onDone={() => undefined} onRetry={() => undefined} results={results} tools={tools} />);

    expect(screen.getByText("2 成功")).toBeInTheDocument();
    expect(screen.getByText("1 失败")).toBeInTheDocument();
    expect(screen.getByText("1 跳过")).toBeInTheDocument();
  });
});
