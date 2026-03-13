import { theme } from "../styles/theme";
import type { AppVersionInfo } from "../types";

interface AppVersionBannerProps {
  versionInfo: AppVersionInfo;
}

function getStatus(versionInfo: AppVersionInfo) {
  if (!versionInfo.latest_version) {
    return {
      label: "未配置更新",
      color: theme.textMuted,
      background: "rgba(255,255,255,0.08)",
      detail: "最新版本信息未提供",
    };
  }

  if (versionInfo.upgrade_available) {
    return {
      label: "可升级",
      color: theme.accent,
      background: "rgba(232,123,53,0.16)",
      detail: `最新版本 ${versionInfo.latest_version}`,
    };
  }

  return {
    label: "已是最新",
    color: theme.success,
    background: "rgba(76,175,80,0.16)",
    detail: `最新版本 ${versionInfo.latest_version}`,
  };
}

function AppVersionBanner({ versionInfo }: AppVersionBannerProps) {
  const status = getStatus(versionInfo);

  return (
    <section
      className="flex items-center justify-between rounded-2xl border px-5 py-4 backdrop-blur-sm"
      style={{
        background: theme.card,
        borderColor: theme.cardBorder,
        borderRadius: theme.radius,
      }}
    >
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.24em]" style={{ color: theme.textMuted }}>
          安装器版本
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-sm font-medium text-white">当前版本 {versionInfo.current_version}</p>
          <p className="text-sm" style={{ color: theme.textSecondary }}>
            {status.detail}
          </p>
        </div>
        {versionInfo.upgrade_available && versionInfo.download_url ? (
          <p className="mt-2 text-xs" style={{ color: theme.textMuted }}>
            已配置升级地址
          </p>
        ) : null}
      </div>

      <span
        className="inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium"
        style={{
          background: status.background,
          color: status.color,
        }}
      >
        {status.label}
      </span>
    </section>
  );
}

export default AppVersionBanner;
