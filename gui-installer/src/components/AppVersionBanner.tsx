import { invoke } from "@tauri-apps/api/core";

import { formatText } from "../lib/strings";
import { theme } from "../styles/theme";
import type { AppVersionInfo } from "../types";

interface AppVersionBannerProps {
  versionInfo: AppVersionInfo;
}

function AppVersionBanner({ versionInfo }: AppVersionBannerProps) {
  const isUpgradable = versionInfo.upgrade_available;
  const url = versionInfo.release_url || versionInfo.download_url;
  const clickable = Boolean(url);

  async function openRelease() {
    if (!url) return;
    await invoke("open_external_url", { url });
  }

  return (
    <button
      className="flex items-center gap-2 rounded-lg px-2 py-1 disabled:cursor-default"
      disabled={!clickable}
      onClick={() => void openRelease()}
      style={{ background: clickable ? theme.bgTertiary : "transparent" }}
      type="button"
    >
      <span className="text-xs" style={{ color: theme.textMuted }}>
        v{versionInfo.current_version}
      </span>
      {isUpgradable && versionInfo.latest_version && (
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            background: theme.accentLight,
            color: theme.accent,
          }}
        >
          {formatText("app.version.available", { version: versionInfo.latest_version })}
        </span>
      )}
    </button>
  );
}

export default AppVersionBanner;
