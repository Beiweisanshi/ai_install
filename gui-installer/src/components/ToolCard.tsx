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

const statusConfig: Record<ToolStatus, { label: string; color: string; bg: string }> = {
  not_installed: { label: "未安装", color: theme.textMuted, bg: theme.bgTertiary },
  installed: { label: "已安装", color: theme.success, bg: theme.successLight },
  upgradable: { label: "可升级", color: theme.accent, bg: theme.accentLight },
  unavailable: { label: "不可用", color: theme.error, bg: theme.errorLight },
  installing: { label: "安装中", color: theme.accent, bg: theme.accentLight },
  success: { label: "成功", color: theme.success, bg: theme.successLight },
  failed: { label: "失败", color: theme.error, bg: theme.errorLight },
  skipped: { label: "已跳过", color: theme.textMuted, bg: theme.bgTertiary },
};

function getVersionText(
  status: ToolStatus,
  currentVersion?: string,
  availableVersion?: string,
  detailText?: string,
) {
  if (detailText) return detailText;

  const isInstalled = status === "installed" || status === "upgradable";

  if (currentVersion && availableVersion) {
    if (currentVersion === availableVersion) {
      return `${currentVersion}（最新）`;
    }
    return `${currentVersion} → ${availableVersion}`;
  }

  if (currentVersion) return currentVersion;
  if (availableVersion) return isInstalled ? availableVersion : `可安装 ${availableVersion}`;
  return "—";
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
  const cfg = statusConfig[status];
  const percent = Math.max(0, Math.min(100, progress ?? 0));

  return (
    <label
      className={`block rounded-xl border transition-all duration-200 ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:shadow-md"
      }`}
      style={{
        background: checked && !disabled ? theme.card : theme.bgSecondary,
        borderColor: checked && !disabled ? theme.accent : theme.cardBorder,
        boxShadow: checked && !disabled ? theme.cardShadowHover : theme.cardShadow,
      }}
    >
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        {/* Custom checkbox */}
        <div className="relative flex shrink-0 items-center">
          <input
            checked={checked}
            className="peer sr-only"
            disabled={disabled}
            onChange={onToggle}
            type="checkbox"
          />
          <div
            className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition-all duration-150"
            style={{
              background: checked ? theme.accent : "transparent",
              borderColor: checked ? theme.accent : theme.border,
            }}
          >
            {checked && (
              <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2">
                <path d="M2.5 6L5 8.5L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold" style={{ color: theme.textPrimary }}>
                {name}
              </h3>
              <p className="mt-0.5 truncate text-xs" style={{ color: theme.textMuted }}>
                {getVersionText(status, currentVersion, availableVersion, detailText)}
              </p>
            </div>

            <span
              className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{ background: cfg.bg, color: cfg.color }}
            >
              {cfg.label}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {status === "installing" && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: theme.textMuted }}>
            <span>安装中</span>
            <span>{percent}%</span>
          </div>
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ background: theme.bgTertiary }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                background: theme.accent,
                width: `${percent}%`,
              }}
            />
          </div>
        </div>
      )}
    </label>
  );
}

export default ToolCard;
