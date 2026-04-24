import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import ToolList from "./ToolList";
import type { DetectResult } from "../types";

const tools: DetectResult[] = [
  {
    name: "Claude Code",
    installed: false,
    current_version: null,
    available_version: "1.0.0",
    upgradable: false,
    installable: true,
    unavailable_reason: null,
  },
  {
    name: "CC-Switch",
    installed: true,
    current_version: "1.0.0",
    available_version: "1.1.0",
    upgradable: true,
    installable: true,
    unavailable_reason: null,
  },
  {
    name: "Codex CLI",
    installed: false,
    current_version: null,
    available_version: "0.9.0",
    upgradable: false,
    installable: true,
    unavailable_reason: null,
  },
  {
    name: "Nushell",
    installed: false,
    current_version: null,
    available_version: null,
    upgradable: false,
    installable: false,
    unavailable_reason: "Missing local package",
  },
];

describe("ToolList", () => {
  it("renders tool cards and the start button", () => {
    render(
      <ToolList
        installing={false}
        onDeselectAll={vi.fn()}
        onSelectAll={vi.fn()}
        onStartInstall={vi.fn()}
        onToggle={vi.fn()}
        progress={{}}
        selected={new Set(["Claude Code", "CC-Switch"])}
        tools={tools}
      />,
    );

    expect(screen.getByText("zm_tools")).toBeInTheDocument();
    expect(screen.getByText("4 个工具")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "开始安装" })).toBeInTheDocument();
  });

  it("supports select all and clear for installable tools only", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [selected, setSelected] = useState<Set<string>>(new Set(["Claude Code"]));

      return (
        <ToolList
          installing={false}
          onDeselectAll={() => setSelected(new Set())}
          onSelectAll={() => setSelected(new Set(tools.filter((tool) => tool.installable).map((tool) => tool.name)))}
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

    expect(screen.getByText("已选 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByText("已选 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.getByText("已选 0")).toBeInTheDocument();
  });

  it("disables unavailable tools", () => {
    render(
      <ToolList
        installing={false}
        onDeselectAll={vi.fn()}
        onSelectAll={vi.fn()}
        onStartInstall={vi.fn()}
        onToggle={vi.fn()}
        progress={{}}
        selected={new Set(["Claude Code"])}
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
        onDeselectAll={vi.fn()}
        onSelectAll={vi.fn()}
        onStartInstall={onStartInstall}
        onToggle={vi.fn()}
        progress={{}}
        selected={new Set(["Claude Code"])}
        tools={tools}
      />,
    );

    await user.click(screen.getByRole("button", { name: "开始安装" }));
    expect(onStartInstall).toHaveBeenCalledTimes(1);
  });
});
