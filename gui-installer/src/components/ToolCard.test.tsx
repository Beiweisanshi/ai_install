import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import ToolCard from "./ToolCard";

describe("ToolCard", () => {
  it.each([
    {
      status: "not_installed" as const,
      currentVersion: undefined,
      availableVersion: "1.0.0",
      expectedLabel: "未安装",
      expectedVersion: "可安装 1.0.0",
    },
    {
      status: "installed" as const,
      currentVersion: "1.0.0",
      availableVersion: undefined,
      expectedLabel: "已安装",
      expectedVersion: "1.0.0",
    },
    {
      status: "installed" as const,
      currentVersion: "0.32.1",
      availableVersion: "0.32.1",
      expectedLabel: "已安装",
      expectedVersion: "0.32.1（最新）",
    },
    {
      status: "upgradable" as const,
      currentVersion: "1.0.0",
      availableVersion: "1.1.0",
      expectedLabel: "可升级",
      expectedVersion: "1.0.0 → 1.1.0",
    },
    {
      status: "success" as const,
      currentVersion: "1.1.0",
      availableVersion: undefined,
      expectedLabel: "成功",
      expectedVersion: "1.1.0",
    },
    {
      status: "failed" as const,
      currentVersion: undefined,
      availableVersion: undefined,
      expectedLabel: "失败",
      expectedVersion: "—",
    },
  ])("renders $status state", ({ status, currentVersion, availableVersion, expectedLabel, expectedVersion }) => {
    render(
      <ToolCard
        availableVersion={availableVersion}
        checked={false}
        currentVersion={currentVersion}
        name="Codex"
        onToggle={vi.fn()}
        status={status}
      />,
    );

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    expect(screen.getByText(expectedVersion)).toBeInTheDocument();
  });

  it("renders unavailable state with a custom detail", () => {
    render(
      <ToolCard
        checked={false}
        detailText="Missing local package"
        disabled={true}
        name="Nushell"
        onToggle={vi.fn()}
        status="unavailable"
      />,
    );

    expect(screen.getByText("不可用")).toBeInTheDocument();
    expect(screen.getByText("Missing local package")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("toggles checkbox on click", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [checked, setChecked] = useState(false);

      return (
        <ToolCard
          checked={checked}
          name="Gemini"
          onToggle={() => setChecked((current) => !current)}
          status="not_installed"
        />
      );
    }

    render(<Harness />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("shows progress bar while installing", () => {
    const { container } = render(
      <ToolCard
        checked={true}
        currentVersion="1.0.0"
        name="Claude Code"
        onToggle={vi.fn()}
        progress={45}
        status="installing"
      />,
    );

    expect(screen.getAllByText("安装中")).toHaveLength(2);
    expect(screen.getByText(/45\s*%/)).toBeInTheDocument();

    const progressBar = container.querySelector('[style*="width: 45%"]');
    expect(progressBar).toBeInTheDocument();
  });
});
