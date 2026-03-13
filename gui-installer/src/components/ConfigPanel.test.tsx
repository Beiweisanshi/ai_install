import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ConfigPanel from "./ConfigPanel";

describe("ConfigPanel", () => {
  it("renders the configuration panel", () => {
    render(<ConfigPanel onSave={vi.fn()} onSkip={vi.fn()} tools={["Codex"]} />);

    expect(screen.getByText("配置 API 凭据")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://api.example.com")).toBeInTheDocument();
  });

  it("renders API Key input as password type", () => {
    render(<ConfigPanel onSave={vi.fn()} onSkip={vi.fn()} tools={["Codex"]} />);

    const apiKeyInput = screen.getByPlaceholderText("请输入 API Key");
    expect(apiKeyInput).toHaveAttribute("type", "password");
  });

  it("calls onSkip when clicking the skip button", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();

    render(<ConfigPanel onSave={vi.fn()} onSkip={onSkip} tools={["Codex"]} />);

    await user.click(screen.getByRole("button", { name: "跳过" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
