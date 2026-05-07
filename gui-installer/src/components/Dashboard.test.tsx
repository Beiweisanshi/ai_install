import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import Dashboard from "./Dashboard";
import type { AiToolId, ApiKey, ChannelConfig, DetectResult, UserProfile } from "../types";

type LaunchHandler = (tool: AiToolId, modeId: string, cwd: string | null) => void;

const RECENT_CWDS_KEY = "zm_tools_recent_cwds";

function detectResult(name: string, installed = true): DetectResult {
  return {
    name,
    installed,
    current_version: installed ? "1.0.0" : null,
    available_version: "1.0.0",
    upgradable: false,
    installable: true,
    unavailable_reason: null,
    required: false,
    group: "npm",
  };
}

function defaultChannel(): ChannelConfig {
  return {
    id: "default",
    name: "默认渠道",
    isDefault: true,
    toolConfigs: {
      claude: { baseUrl: "https://api.example.com/v1", apiKey: "" },
      codex: { baseUrl: "https://api.example.com/v1", apiKey: "" },
      gemini: { baseUrl: "https://api.example.com/v1beta", apiKey: "" },
      opencode: { baseUrl: "https://api.example.com/v1", apiKey: "" },
    },
  };
}

function apiKey(platform: string, id: number, name: string): ApiKey {
  return {
    id,
    key: `sk-${platform}-${id}-secret`,
    name,
    status: "active",
    group_id: 1,
    quota: 1000,
    quota_used: 0,
    expires_at: null,
    created_at: "2024-01-01T00:00:00Z",
    group: { id: 1, name: "primary", platform },
  };
}

function profile(): UserProfile {
  return {
    id: 1,
    email: "user@example.com",
    balance: 100,
  };
}

interface RenderOptions {
  tools?: DetectResult[];
  apiKeys?: ApiKey[];
  onLaunch?: Mock<LaunchHandler>;
}

function renderDashboard(opts: RenderOptions = {}) {
  const onLaunch = opts.onLaunch ?? vi.fn<LaunchHandler>();
  const tools = opts.tools ?? [
    detectResult("Codex CLI"),
    detectResult("Claude CLI"),
    detectResult("Gemini CLI"),
    detectResult("OpenCode"),
  ];
  const keys = opts.apiKeys ?? [
    apiKey("anthropic", 1, "claude-key"),
    apiKey("openai", 2, "openai-key"),
    apiKey("gemini", 3, "gemini-key"),
  ];

  render(
    <Dashboard
      apiKeys={keys}
      appVersionInfo={null}
      balanceLoading={false}
      channels={[defaultChannel()]}
      currentChannel={defaultChannel()}
      darkMode={false}
      keySelections={{ claude: 1, codex: 2, gemini: 3, opencode: 2 }}
      onDarkModeChange={vi.fn()}
      onDeleteChannel={vi.fn()}
      onInstall={vi.fn()}
      onLaunch={onLaunch}
      onLogout={vi.fn()}
      onOpenKeyManager={vi.fn()}
      onRecharge={vi.fn()}
      onRefresh={vi.fn()}
      onRefreshBalance={vi.fn()}
      onRememberLoginChange={vi.fn()}
      onSaveChannel={vi.fn()}
      onSelectToolKey={vi.fn()}
      onSwitchChannel={vi.fn()}
      profile={profile()}
      rememberLogin={true}
      tools={tools}
    />,
  );

  return { onLaunch };
}

async function openLaunchDialog(toolName: string) {
  const user = userEvent.setup();
  const cards = screen.getAllByRole("article");
  const card = cards.find((node) => within(node).queryByRole("heading", { name: toolName }));
  if (!card) throw new Error(`Card for ${toolName} not found`);
  await user.click(within(card).getByRole("button", { name: "打开终端" }));
  return user;
}

describe("Dashboard launch dialog", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the full claude mode list (5 buttons) inside the launch dialog", async () => {
    renderDashboard();
    await openLaunchDialog("Claude");

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("默认")).toBeInTheDocument();
    expect(within(dialog).getByText("自动接受编辑")).toBeInTheDocument();
    expect(within(dialog).getByText("Plan 模式")).toBeInTheDocument();
    expect(within(dialog).getByText("智能自动")).toBeInTheDocument();
    expect(within(dialog).getByText("危险：跳过所有权限检查")).toBeInTheDocument();
  });

  it("renders the full opencode mode list (2 buttons) inside the launch dialog", async () => {
    renderDashboard();
    await openLaunchDialog("OpenCode");

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("默认")).toBeInTheDocument();
    expect(within(dialog).getByText("允许全部权限")).toBeInTheDocument();
  });

  it("invokes onLaunch immediately for caution-level modes (no danger confirmation)", async () => {
    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Gemini");

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByText("YOLO（自动接受全部）"));

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("gemini", "gemini.yolo", null);
    // No second dialog (the danger modal) should appear.
    expect(screen.queryByText(/确认以最高权限启动/)).not.toBeInTheDocument();
  });

  it("opens the danger confirmation for codex.dangerous before invoking onLaunch", async () => {
    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Codex");

    let dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByText("危险：绕过审批与沙箱"));

    // onLaunch must NOT have fired yet — we await user confirmation first.
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByText(/确认以最高权限启动 Codex/)).toBeInTheDocument();

    // Tick the risk acknowledgement and confirm.
    const dialogs = screen.getAllByRole("dialog");
    dialog = dialogs[dialogs.length - 1];
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "继续启动" }));

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("codex", "codex.dangerous", null);
  });

  it("preselects the most-recent cwd from localStorage", async () => {
    localStorage.setItem(
      RECENT_CWDS_KEY,
      JSON.stringify(["D:\\study\\ai_download\\ai_install", "D:\\other"]),
    );

    renderDashboard();
    await openLaunchDialog("Codex");

    const dialog = screen.getByRole("dialog");
    const inputs = within(dialog).getAllByRole("textbox");
    expect(inputs[0]).toHaveValue("D:\\study\\ai_download\\ai_install");

    // The recent paths should also be available in the dropdown.
    const select = within(dialog).getByRole("combobox", { name: "工作目录" });
    expect(within(select).getByText("D:\\study\\ai_download\\ai_install")).toBeInTheDocument();
    expect(within(select).getByText("D:\\other")).toBeInTheDocument();
  });

  it("forwards the entered cwd to onLaunch when launching", async () => {
    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Codex");

    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getAllByRole("textbox")[0];
    await user.clear(input);
    await user.type(input, "C:\\projects\\demo");

    await user.click(within(dialog).getByText("默认"));

    expect(onLaunch).toHaveBeenCalledWith("codex", "codex.default", "C:\\projects\\demo");
  });
});
