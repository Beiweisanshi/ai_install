import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useInstaller } from "./useInstaller";

function Harness() {
  const installer = useInstaller();

  return (
    <div>
      <div data-testid="phase">{installer.phase}</div>
      <div data-testid="selected">{Array.from(installer.selected).sort().join(",")}</div>
      <button onClick={installer.selectAll} type="button">
        select-all
      </button>
    </div>
  );
}

describe("useInstaller", () => {
  it("enters dashboard when required tools are installed", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_app_version_info") {
        return {
          current_version: "0.1.0",
          latest_version: "0.2.0",
          upgrade_available: true,
          download_url: null,
        };
      }

      return [
        tool("Git", true, "2.0.0", "2.0.0", false, true, true, "vcs"),
        tool("Node.js", true, "24.0.0", "24.0.0", false, true, true, "runtime"),
        tool("Claude CLI", false, null, "1.0.0", false, true, false, "npm"),
      ];
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("dashboard"));
    expect(screen.getByTestId("selected")).toHaveTextContent("Claude CLI");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_app_version_info");
  });

  it("enters installer when a required tool is missing", async () => {
    const user = userEvent.setup();

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_app_version_info") {
        return {
          current_version: "0.1.0",
          latest_version: null,
          upgrade_available: false,
          download_url: null,
        };
      }

      return [
        tool("Git", true, "2.0.0", "2.0.0", false, true, true, "vcs"),
        tool("Node.js", false, null, "24.0.0", false, true, true, "runtime"),
        tool("Claude CLI", false, null, "1.0.0", false, true, false, "npm"),
        tool("Nushell", false, null, null, false, false, false, "runtime", "Missing local package"),
      ];
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("selecting"));
    expect(screen.getByTestId("selected")).toHaveTextContent("Node.js");

    await user.click(screen.getByRole("button", { name: "select-all" }));
    await waitFor(() =>
      expect(screen.getByTestId("selected")).toHaveTextContent("Claude CLI,Node.js"),
    );
  });
});

function tool(
  name: string,
  installed: boolean,
  currentVersion: string | null,
  availableVersion: string | null,
  upgradable: boolean,
  installable: boolean,
  required: boolean,
  group: string,
  unavailableReason: string | null = null,
) {
  return {
    name,
    installed,
    current_version: currentVersion,
    available_version: availableVersion,
    upgradable,
    installable,
    unavailable_reason: unavailableReason,
    required,
    group,
  };
}
