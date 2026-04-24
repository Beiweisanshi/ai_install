import { theme } from "../styles/theme";
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div
        className="w-[480px] max-w-[90vw] rounded-xl p-5 shadow-xl"
        style={{
          background: theme.card,
          border: `1px solid ${theme.cardBorder}`,
        }}
      >
        <h2 className="text-base font-semibold" style={{ color: theme.textPrimary }}>
          无法升级 {state.toolName}
        </h2>
        <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
          检测到以下进程正在使用 <code>{state.pkg}</code>，
          请先关闭它们，否则 npm 安装会长时间无响应。
        </p>

        <ul
          className="mt-3 max-h-40 overflow-auto rounded-lg p-2 text-xs font-mono"
          style={{ background: theme.bgTertiary, color: theme.textSecondary }}
        >
          {state.processes.length === 0 ? (
            <li style={{ color: theme.textMuted }}>（当前未检测到占用进程，可直接重试）</li>
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
            取消
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
            我已关闭，重试
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
            关闭所有进程并重试
          </button>
        </div>
      </div>
    </div>
  );
}

export default BlockingProcessesModal;
