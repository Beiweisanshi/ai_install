import { useEffect } from "react";

import { theme } from "../styles/theme";

export type ToastKind = "ok" | "err";

interface ToastProps {
  kind: ToastKind;
  text: string;
  onDismiss: () => void;
  durationMs?: number;
}

function Toast({ kind, text, onDismiss, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [onDismiss, durationMs]);

  const isOk = kind === "ok";
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg px-4 py-2 text-sm shadow-lg"
      style={{
        background: isOk ? theme.successLight : theme.errorLight,
        color: isOk ? theme.success : theme.error,
        border: `1px solid ${isOk ? theme.success : theme.error}`,
      }}
    >
      {text}
    </div>
  );
}

export default Toast;
