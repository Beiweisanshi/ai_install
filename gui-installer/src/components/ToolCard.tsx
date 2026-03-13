import { theme } from "../styles/theme";

type ToolStatus =
  | "not_installed"
  | "installed"
  | "upgradable"
  | "unavailable"
  | "installing"
  | "success"
  | "failed"
  | "skipped";

interface ToolCardProps {
  name: string;
  currentVersion?: string;
  availableVersion?: string;
  detailText?: string;
  status: ToolStatus;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  progress?: number;
}

const statusStyleMap: Record<ToolStatus, { label: string; color: string; background: string }> = {
  not_installed: {
    label: "未安装",
    color: theme.textMuted,
    background: "rgba(255,255,255,0.08)",
  },
  installed: {
    label: "已安装",
    color: theme.success,
    background: "rgba(76,175,80,0.16)",
  },
  upgradable: {
    label: "可升级",
    color: theme.accent,
    background: "rgba(232,123,53,0.16)",
  },
  unavailable: {
    label: "不可用",
    color: theme.error,
    background: "rgba(244,67,54,0.16)",
  },
  installing: {
    label: "安装中",
    color: theme.accent,
    background: "rgba(232,123,53,0.16)",
  },
  success: {
    label: "成功",
    color: theme.success,
    background: "rgba(76,175,80,0.16)",
  },
  failed: {
    label: "失败",
    color: theme.error,
    background: "rgba(244,67,54,0.16)",
  },
  skipped: {
    label: "已跳过",
    color: theme.textMuted,
    background: "rgba(255,255,255,0.08)",
  },
};

function getVersionText(
  status: ToolStatus,
  currentVersion?: string,
  availableVersion?: string,
  detailText?: string,
) {
  if (detailText) {
    return detailText;
  }

  const isInstalled = status === "installed" || status === "upgradable";

  if (currentVersion && availableVersion) {
    if (currentVersion === availableVersion) {
      return `当前版本 ${currentVersion}（已是最新）`;
    }

    return `当前版本 ${currentVersion} → 最新版本 ${availableVersion}`;
  }

  if (currentVersion) {
    return `当前版本 ${currentVersion}`;
  }

  if (availableVersion) {
    return isInstalled ? `最新版本 ${availableVersion}` : `可安装版本 ${availableVersion}`;
  }

  return "未检测到版本信息";
}

function ToolCard({
  name,
  currentVersion,
  availableVersion,
  detailText,
  status,
  checked,
  disabled = false,
  onToggle,
  progress,
}: ToolCardProps) {
  const statusStyle = statusStyleMap[status];
  const percent = Math.max(0, Math.min(100, progress ?? 0));

  return (
    <label
      className={`block rounded-xl border p-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition duration-200 ${
        disabled
          ? "cursor-not-allowed opacity-70"
          : "cursor-pointer hover:-translate-y-0.5 hover:border-white/20"
      }`}
      style={{
        background: theme.card,
        borderColor: theme.cardBorder,
        borderRadius: theme.radius,
      }}
    >
      <div className="flex items-start gap-4">
        <input
          checked={checked}
          className={`mt-1 h-4 w-4 shrink-0 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          disabled={disabled}
          onChange={onToggle}
          style={{ accentColor: theme.accent }}
          type="checkbox"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-white">{name}</h3>
              <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
                {getVersionText(status, currentVersion, availableVersion, detailText)}
              </p>
            </div>

            <span
              className="inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: statusStyle.background,
                color: statusStyle.color,
              }}
            >
              {statusStyle.label}
            </span>
          </div>

          {status === "installing" ? (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs" style={{ color: theme.textMuted }}>
                <span>安装进度</span>
                <span>{percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${theme.accent} 0%, #f5a76b 100%)`,
                    transition: "width 0.5s ease-out",
                    width: `${percent}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </label>
  );
}

export default ToolCard;
