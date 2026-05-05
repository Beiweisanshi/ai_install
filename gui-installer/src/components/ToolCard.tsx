import { formatText, t } from "../lib/strings";
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
  not_installed: { label: t("tool.status.notInstalled"), color: theme.textMuted, bg: theme.bgTertiary },
  installed: { label: t("tool.status.installed"), color: theme.success, bg: theme.successLight },
  upgradable: { label: t("tool.status.upgradable"), color: theme.accent, bg: theme.accentLight },
  unavailable: { label: t("tool.status.unavailable"), color: theme.error, bg: theme.errorLight },
  installing: { label: t("tool.status.installing"), color: theme.accent, bg: theme.accentLight },
  success: { label: t("tool.status.success"), color: theme.success, bg: theme.successLight },
  failed: { label: t("tool.status.failed"), color: theme.error, bg: theme.errorLight },
  skipped: { label: t("tool.status.skipped"), color: theme.textMuted, bg: theme.bgTertiary },
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
      return formatText("tool.version.latest", { version: currentVersion });
    }
    return `${currentVersion} -> ${availableVersion}`;
  }

  if (currentVersion) return currentVersion;
  if (availableVersion) return isInstalled ? availableVersion : formatText("tool.version.installable", { version: availableVersion });
  return "-";
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
      className={`block rounded-lg border transition-all duration-200 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:shadow-md"
      }`}
      style={{
        background: checked && !disabled ? theme.card : theme.bgSecondary,
        borderColor: checked && !disabled ? theme.accent : theme.cardBorder,
        boxShadow: checked && !disabled ? theme.cardShadowHover : theme.cardShadow,
      }}
    >
      <div className="flex items-center gap-3.5 px-4 py-3.5">
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
              <svg
                className="h-3 w-3 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 12 12"
              >
                <path d="M2.5 6L5 8.5L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>

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

      {status === "installing" && (
        <div className="px-4 pb-3">
          <div className="mb-1 flex items-center justify-between text-[10px]" style={{ color: theme.textMuted }}>
            <span>{t("tool.status.installing")}</span>
            <span>{percent}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: theme.bgTertiary }}>
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
