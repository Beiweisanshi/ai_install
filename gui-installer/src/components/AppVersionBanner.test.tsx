import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AppVersionBanner from "./AppVersionBanner";

describe("AppVersionBanner", () => {
  it("renders upgrade status when a newer version is available", () => {
    render(
      <AppVersionBanner
        versionInfo={{
          current_version: "0.1.0",
          latest_version: "0.2.0",
          upgrade_available: true,
          download_url: "https://example.com/download",
        }}
      />,
    );

    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
    expect(screen.getByText("0.2.0 可用")).toBeInTheDocument();
  });

  it("renders only current version when no upgrade is available", () => {
    render(
      <AppVersionBanner
        versionInfo={{
          current_version: "0.1.0",
          latest_version: null,
          upgrade_available: false,
          download_url: null,
        }}
      />,
    );

    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
    expect(screen.queryByText(/可用/)).not.toBeInTheDocument();
  });
});
