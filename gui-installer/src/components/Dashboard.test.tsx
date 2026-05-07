import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import Dashboard from "./Dashboard";
import type { AiToolId, ApiKey, ChannelConfig, DetectResult, UserProfile } from "../types";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { open as openDialog } from "@tauri-apps/plugin-dialog";

type LaunchHandler = (tool: AiToolId, modeId: string, cwd: string | null) => void;

const RECENT_CWDS_KEY = "zm_tools_recent_cwds";
const LAST_CONFIRMED_LAUNCH_KEY = "zm_tools_last_confirmed_launch";
const DEFAULT_CWD = "D:\\proj";

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

function getLaunchDialog() {
  // The first dialog is the LaunchDialog; the danger confirmation, when
  // present, is the second/last dialog (z-index 30).
  const dialogs = screen.getAllByRole("dialog");
  return dialogs[0];
}

function getDangerDialog() {
  const dialogs = screen.getAllByRole("dialog");
  return dialogs[dialogs.length - 1];
}

async function selectMode(user: ReturnType<typeof userEvent.setup>, label: string) {
  const dialog = getLaunchDialog();
  const select = within(dialog).getByRole("combobox", { name: "启动模式" });
  await user.selectOptions(select, within(select).getByRole("option", { name: label }));
}

async function fillCwd(user: ReturnType<typeof userEvent.setup>, value: string) {
  const dialog = getLaunchDialog();
  const input = within(dialog).getAllByRole("textbox")[0];
  await user.clear(input);
  if (value.length > 0) {
    await user.type(input, value);
  }
}

async function clickLaunch(user: ReturnType<typeof userEvent.setup>) {
  const dialog = getLaunchDialog();
  await user.click(within(dialog).getByRole("button", { name: "启动" }));
}

async function confirmDanger(user: ReturnType<typeof userEvent.setup>) {
  const dialog = getDangerDialog();
  await user.click(within(dialog).getByRole("checkbox"));
  await user.click(within(dialog).getByRole("button", { name: "继续启动" }));
}

describe("Dashboard launch dialog", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openDialog).mockReset();
    // Pre-populate the recent cwd list so cwd is non-empty by default.
    localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify([DEFAULT_CWD]));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the full claude mode list (5 options) inside the launch dialog", async () => {
    renderDashboard();
    const user = await openLaunchDialog("Claude");
    void user;

    const dialog = getLaunchDialog();
    const select = within(dialog).getByRole("combobox", { name: "启动模式" });
    expect(within(select).getByRole("option", { name: "默认" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "自动接受编辑" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Plan 模式" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "智能自动" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "危险：跳过所有权限检查" })).toBeInTheDocument();
  });

  it("renders the full opencode mode list (2 options) inside the launch dialog", async () => {
    renderDashboard();
    await openLaunchDialog("OpenCode");

    const dialog = getLaunchDialog();
    const select = within(dialog).getByRole("combobox", { name: "启动模式" });
    expect(within(select).getByRole("option", { name: "默认" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "允许全部权限" })).toBeInTheDocument();
  });

  it("invokes onLaunch immediately for caution-level modes (no danger confirmation)", async () => {
    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Gemini");

    await selectMode(user, "YOLO（自动接受全部）");
    await clickLaunch(user);

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("gemini", "gemini.yolo", DEFAULT_CWD);
    expect(screen.queryByText(/确认以最高权限启动/)).not.toBeInTheDocument();
  });

  it("does not launch when a mode is selected from the dropdown (no implicit launch)", async () => {
    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Codex");

    await selectMode(user, "危险：绕过审批与沙箱");

    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.queryByText(/确认以最高权限启动/)).not.toBeInTheDocument();
  });

  it("opens the danger confirmation for codex.dangerous before invoking onLaunch", async () => {
    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Codex");

    await selectMode(user, "危险：绕过审批与沙箱");
    await clickLaunch(user);

    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByText(/确认以最高权限启动 Codex/)).toBeInTheDocument();

    await confirmDanger(user);

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("codex", "codex.dangerous", DEFAULT_CWD);
  });

  it("preselects the most-recent cwd from localStorage", async () => {
    localStorage.setItem(
      RECENT_CWDS_KEY,
      JSON.stringify(["D:\\study\\ai_download\\ai_install", "D:\\other"]),
    );

    renderDashboard();
    await openLaunchDialog("Codex");

    const dialog = getLaunchDialog();
    const inputs = within(dialog).getAllByRole("textbox");
    expect(inputs[0]).toHaveValue("D:\\study\\ai_download\\ai_install");

    const select = within(dialog).getByRole("combobox", { name: "工作目录" });
    expect(within(select).getByText("D:\\study\\ai_download\\ai_install")).toBeInTheDocument();
    expect(within(select).getByText("D:\\other")).toBeInTheDocument();
  });

  it("forwards the entered cwd to onLaunch when launching", async () => {
    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Codex");

    await fillCwd(user, "C:\\projects\\demo");
    await selectMode(user, "默认");
    await clickLaunch(user);

    expect(onLaunch).toHaveBeenCalledWith("codex", "codex.default", "C:\\projects\\demo");
  });
});

describe("Dashboard launch button — disabled conditions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openDialog).mockReset();
    localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify([DEFAULT_CWD]));
  });

  it("disables the launch button when cwd is empty or whitespace-only", async () => {
    renderDashboard();
    const user = await openLaunchDialog("Codex");

    const dialog = getLaunchDialog();
    const launchBtn = within(dialog).getByRole("button", { name: "启动" });

    // Pre-populated → enabled.
    expect(launchBtn).not.toBeDisabled();

    // Empty cwd → disabled.
    await fillCwd(user, "");
    expect(launchBtn).toBeDisabled();

    // Whitespace-only cwd → still disabled (trimmed).
    await fillCwd(user, "   ");
    expect(launchBtn).toBeDisabled();

    // Non-empty cwd → enabled again.
    await fillCwd(user, "C:\\x");
    expect(launchBtn).not.toBeDisabled();
  });
});

describe("Dashboard dangerous-launch dedup", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openDialog).mockReset();
    localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify([DEFAULT_CWD]));
  });

  it("skips the danger dialog on a second identical dangerous launch", async () => {
    const { onLaunch } = renderDashboard();
    let user = await openLaunchDialog("Codex");

    // First launch: danger dialog appears, user confirms.
    await selectMode(user, "危险：绕过审批与沙箱");
    await clickLaunch(user);
    expect(screen.getByText(/确认以最高权限启动 Codex/)).toBeInTheDocument();
    await confirmDanger(user);
    expect(onLaunch).toHaveBeenCalledTimes(1);

    // Re-open the launch dialog with identical cwd+mode.
    user = await openLaunchDialog("Codex");
    await selectMode(user, "危险：绕过审批与沙箱");
    await clickLaunch(user);

    // Danger dialog must NOT re-appear; onLaunch fires directly.
    expect(screen.queryByText(/确认以最高权限启动/)).not.toBeInTheDocument();
    expect(onLaunch).toHaveBeenCalledTimes(2);
    expect(onLaunch).toHaveBeenLastCalledWith("codex", "codex.dangerous", DEFAULT_CWD);
  });

  it("re-prompts the danger dialog when cwd changes between launches", async () => {
    const { onLaunch } = renderDashboard();
    let user = await openLaunchDialog("Codex");

    await selectMode(user, "危险：绕过审批与沙箱");
    await clickLaunch(user);
    await confirmDanger(user);

    user = await openLaunchDialog("Codex");
    await selectMode(user, "危险：绕过审批与沙箱");
    await fillCwd(user, "D:\\different");
    await clickLaunch(user);

    expect(screen.getByText(/确认以最高权限启动 Codex/)).toBeInTheDocument();
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("does not share dedup state across tools (codex confirm does not skip claude)", async () => {
    const { onLaunch } = renderDashboard();
    let user = await openLaunchDialog("Codex");

    await selectMode(user, "危险：绕过审批与沙箱");
    await clickLaunch(user);
    await confirmDanger(user);
    expect(onLaunch).toHaveBeenCalledTimes(1);

    user = await openLaunchDialog("Claude");
    await selectMode(user, "危险：跳过所有权限检查");
    await clickLaunch(user);

    expect(screen.getByText(/确认以最高权限启动 Claude/)).toBeInTheDocument();
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the danger dialog when last-confirmed storage is corrupt", async () => {
    localStorage.setItem(LAST_CONFIRMED_LAUNCH_KEY, "not-json");

    const { onLaunch } = renderDashboard();
    const user = await openLaunchDialog("Codex");

    await selectMode(user, "危险：绕过审批与沙箱");
    await clickLaunch(user);

    expect(screen.getByText(/确认以最高权限启动 Codex/)).toBeInTheDocument();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("keeps the LaunchDialog open after the user cancels the danger dialog", async () => {
    renderDashboard();
    const user = await openLaunchDialog("Codex");

    await selectMode(user, "危险：绕过审批与沙箱");
    await clickLaunch(user);

    // Danger dialog visible.
    expect(screen.getByText(/确认以最高权限启动 Codex/)).toBeInTheDocument();
    // Cancel the danger dialog.
    const dangerDialog = getDangerDialog();
    await user.click(within(dangerDialog).getByRole("button", { name: "取消" }));

    // Danger dialog gone; LaunchDialog still mounted.
    expect(screen.queryByText(/确认以最高权限启动/)).not.toBeInTheDocument();
    expect(screen.getByText(/打开 Codex/)).toBeInTheDocument();
  });
});

describe("Dashboard browse-directory button", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openDialog).mockReset();
    localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify([DEFAULT_CWD]));
  });

  it("calls plugin-dialog.open and writes the picked path back to the cwd input", async () => {
    vi.mocked(openDialog).mockResolvedValueOnce("D:\\picked\\dir");

    renderDashboard();
    const user = await openLaunchDialog("Codex");

    const dialog = getLaunchDialog();
    await user.click(within(dialog).getByRole("button", { name: "选择目录" }));

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      defaultPath: DEFAULT_CWD,
    });

    const input = within(dialog).getAllByRole("textbox")[0];
    expect(input).toHaveValue("D:\\picked\\dir");
  });
});
