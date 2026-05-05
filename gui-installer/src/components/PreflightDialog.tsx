import { formatText, t } from "../lib/strings";
import { theme } from "../styles/theme";
import { closeOnBackdropMouseDown, useDialogKeyboard } from "../hooks/useDialogKeyboard";
import type { PrecheckResult } from "../types";

interface PreflightDialogProps {
  tools: string[];
  result: PrecheckResult;
  onCancel: () => void;
  onConfirm: () => void;
}

const ESTIMATED_MB: Record<string, number> = {
  "Node.js": 80,
  Git: 250,
  Nushell: 30,
  "Claude CLI": 50,
  "Codex CLI": 50,
  "Gemini CLI": 50,
  OpenCode: 50,
};

function PreflightDialog({ tools, result, onCancel, onConfirm }: PreflightDialogProps) {
  const dialogRef = useDialogKeyboard<HTMLDivElement>(true, onCancel);
  const estimated = tools.reduce((sum, tool) => sum + (ESTIMATED_MB[tool] ?? 50), 0);
  const lowDisk = result.disk_free_mb > 0 && result.disk_free_mb < estimated * 2;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4" onMouseDown={closeOnBackdropMouseDown(onCancel)}>
      <div
        className="w-[560px] max-w-[90vw] rounded-lg border p-5"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{
          background: theme.card,
          borderColor: result.blocking_processes.length > 0 || lowDisk ? theme.warning : theme.cardBorder,
          boxShadow: theme.cardShadowHover,
        }}
      >
        <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
          {t("install.preflight")}
        </h2>
        <div className="mt-4 grid gap-3 text-sm" style={{ color: theme.textSecondary }}>
          <div className="rounded-lg px-3 py-2" style={{ background: theme.bgTertiary }}>
            <div>{formatText("preflight.estimatedSpace", { mb: estimated })}</div>
            <div className="mt-1">
              {formatText("preflight.diskFree", { mb: result.disk_free_mb > 0 ? `${result.disk_free_mb} MB` : t("preflight.diskUnreadable") })}
            </div>
            {lowDisk && (
              <div className="mt-2 font-medium" style={{ color: theme.warning }}>
                {t("preflight.lowDisk")}
              </div>
            )}
          </div>

          <div className="rounded-lg px-3 py-2" style={{ background: theme.bgTertiary }}>
            <div className="font-medium" style={{ color: theme.textPrimary }}>
              {t("preflight.closeAppsTitle")}
            </div>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: theme.textMuted }}>
              {t("preflight.closeAppsDescription")}
            </p>
          </div>

          {result.blocking_processes.length > 0 && (
            <div>
              <div className="mb-2 font-medium" style={{ color: theme.warning }}>
                {t("preflight.blockingProcesses")}
              </div>
              <ul className="max-h-36 overflow-auto rounded-lg p-2 text-xs font-mono" style={{ background: theme.bgTertiary }}>
                {result.blocking_processes.map((process) => (
                  <li className="truncate" key={process.pid}>
                    PID {process.pid} - {process.name}
                    {process.executable_path ? ` - ${process.executable_path}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-lg px-3 py-2 text-sm" onClick={onCancel} style={{ color: theme.textSecondary }} type="button">
            {t("common.back")}
          </button>
          <button
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            onClick={onConfirm}
            style={{ background: theme.accent, color: theme.textOnAccent }}
            type="button"
          >
            {t("preflight.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PreflightDialog;
