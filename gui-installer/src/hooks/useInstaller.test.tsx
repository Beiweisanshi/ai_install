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
  it("skips unavailable tools in the default selection and select-all", async () => {
    const user = userEvent.setup();

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
        {
          name: "Claude CLI",
          installed: false,
          current_version: null,
          available_version: "1.0.0",
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
        {
          name: "Codex CLI",
          installed: true,
          current_version: "0.112.0",
          available_version: "0.112.0",
          upgradable: false,
          installable: true,
          unavailable_reason: null,
        },
      ];
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("selecting"));
    expect(screen.getByTestId("selected")).toHaveTextContent("Claude CLI");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_app_version_info");

    await user.click(screen.getByRole("button", { name: "select-all" }));
    await waitFor(() =>
      expect(screen.getByTestId("selected")).toHaveTextContent("Claude CLI,Codex CLI"),
    );
  });
});
