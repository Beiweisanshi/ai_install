import { theme } from "../styles/theme";
import type { AppVersionInfo } from "../types";

interface AppVersionBannerProps {
  versionInfo: AppVersionInfo;
}

function AppVersionBanner({ versionInfo }: AppVersionBannerProps) {
  const isUpgradable = versionInfo.upgrade_available;

  return (
    <div className="flex items-center gap-2">
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
          {versionInfo.latest_version} 可用
        </span>
      )}
    </div>
  );
}

export default AppVersionBanner;
