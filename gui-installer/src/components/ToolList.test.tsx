import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import ToolList from "./ToolList";
import type { DetectResult } from "../types";

const tools: DetectResult[] = [
  {
    name: "Claude CLI",
    installed: false,
    current_version: null,
    available_version: "1.0.0",
    upgradable: false,
    installable: true,
    unavailable_reason: null,
    required: false,
    group: "npm",
  },
  {
    name: "OpenCode",
    installed: true,
    current_version: "1.0.0",
    available_version: "1.1.0",
    upgradable: true,
    installable: true,
    unavailable_reason: null,
    required: false,
    group: "npm",
  },
  {
    name: "Codex CLI",
    installed: true,
    current_version: "0.9.0",
    available_version: "0.9.0",
    upgradable: false,
    installable: true,
    unavailable_reason: null,
    required: false,
    group: "npm",
  },
  {
    name: "Nushell",
    installed: false,
    current_version: null,
    available_version: null,
    upgradable: false,
    installable: false,
    unavailable_reason: "Missing local package",
    required: false,
    group: "runtime",
  },
];

describe("ToolList", () => {
  it("renders tool cards and the start button", () => {
    render(
      <ToolList
        installing={false}
        onBack={vi.fn()}
        onDeselectAll={vi.fn()}
        onSelectAll={vi.fn()}
        onStartInstall={vi.fn()}
        onToggle={vi.fn()}
        progress={{}}
        selected={new Set(["Claude CLI", "OpenCode"])}
        tools={tools}
      />,
    );

    expect(screen.getByText("安装与升级")).toBeInTheDocument();
    expect(screen.getByText("4 个组件")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "开始安装" })).toBeInTheDocument();
  });

  it("supports select all and clear for installable pending tools only", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [selected, setSelected] = useState<Set<string>>(new Set(["Claude CLI"]));

      return (
        <ToolList
          installing={false}
          onBack={vi.fn()}
          onDeselectAll={() => setSelected(new Set())}
          onSelectAll={() =>
            setSelected(
              new Set(
                tools
                  .filter((tool) => tool.installable && (!tool.installed || tool.upgradable))
                  .map((tool) => tool.name),
              ),
            )
          }
          onStartInstall={vi.fn()}
          onToggle={(name) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(name)) {
                next.delete(name);
              } else {
                next.add(name);
              }
              return next;
            })
          }
          progress={{}}
          selected={selected}
          tools={tools}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByText("已选择 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选择 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.getByText("已选择 0")).toBeInTheDocument();
  });

  it("disables unavailable tools", () => {
    render(
      <ToolList
        installing={false}
        onBack={vi.fn()}
        onDeselectAll={vi.fn()}
        onSelectAll={vi.fn()}
        onStartInstall={vi.fn()}
        onToggle={vi.fn()}
        progress={{}}
        selected={new Set(["Claude CLI"])}
        tools={tools}
      />,
    );

    expect(screen.getByText("缺少本地安装包")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[checkboxes.length - 1]).toBeDisabled();
  });

  it("calls start install when clicking the button", async () => {
    const user = userEvent.setup();
    const onStartInstall = vi.fn();

    render(
      <ToolList
        installing={false}
        onBack={vi.fn()}
        onDeselectAll={vi.fn()}
        onSelectAll={vi.fn()}
        onStartInstall={onStartInstall}
        onToggle={vi.fn()}
        progress={{}}
        selected={new Set(["Claude CLI"])}
        tools={tools}
      />,
    );

    await user.click(screen.getByRole("button", { name: "开始安装" }));
    expect(onStartInstall).toHaveBeenCalledTimes(1);
  });
});
