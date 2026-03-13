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

    expect(screen.getByText("当前版本 0.1.0")).toBeInTheDocument();
    expect(screen.getByText("最新版本 0.2.0")).toBeInTheDocument();
    expect(screen.getByText("可升级")).toBeInTheDocument();
    expect(screen.getByText("已配置升级地址")).toBeInTheDocument();
  });

  it("renders missing-update-source state when latest version is unavailable", () => {
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

    expect(screen.getByText("未配置更新")).toBeInTheDocument();
    expect(screen.getByText("最新版本信息未提供")).toBeInTheDocument();
  });
});
