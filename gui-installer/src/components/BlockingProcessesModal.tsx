import { formatText, t } from "../lib/strings";
import { theme } from "../styles/theme";
import { closeOnBackdropMouseDown, useDialogKeyboard } from "../hooks/useDialogKeyboard";
import type { BlockingState } from "../types";

interface BlockingProcessesModalProps {
  state: BlockingState;
  onKillAndRetry: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

function BlockingProcessesModal({
  state,
  onKillAndRetry,
  onRetry,
  onDismiss,
}: BlockingProcessesModalProps) {
  const dialogRef = useDialogKeyboard<HTMLDivElement>(true, onDismiss);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onMouseDown={closeOnBackdropMouseDown(onDismiss)}
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div
        className="w-[480px] max-w-[90vw] rounded-xl p-5 shadow-xl"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{
          background: theme.card,
          border: `1px solid ${theme.cardBorder}`,
        }}
      >
        <h2 className="text-base font-semibold" style={{ color: theme.textPrimary }}>
          {formatText("blocking.title", { toolName: state.toolName })}
        </h2>
        <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
          {t("blocking.descriptionPrefix")} <code>{state.pkg}</code>，{t("blocking.descriptionSuffix")}
        </p>

        <ul
          className="mt-3 max-h-40 overflow-auto rounded-lg p-2 text-xs font-mono"
          style={{ background: theme.bgTertiary, color: theme.textSecondary }}
        >
          {state.processes.length === 0 ? (
            <li style={{ color: theme.textMuted }}>{t("blocking.noProcesses")}</li>
          ) : (
            state.processes.map((p) => (
              <li key={p.pid} className="truncate">
                PID {p.pid} — {p.name}
                {p.executable_path ? ` — ${p.executable_path}` : ""}
              </li>
            ))
          )}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{ background: theme.bgTertiary, color: theme.textSecondary }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{
              background: theme.bgSecondary,
              color: theme.textPrimary,
              border: `1px solid ${theme.cardBorder}`,
            }}
          >
            {t("blocking.retry")}
          </button>
          <button
            type="button"
            onClick={onKillAndRetry}
            disabled={state.processes.length === 0}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              background: state.processes.length === 0 ? theme.bgTertiary : theme.accent,
              color: state.processes.length === 0 ? theme.textMuted : theme.textOnAccent,
              cursor: state.processes.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {t("blocking.killAndRetry")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BlockingProcessesModal;
