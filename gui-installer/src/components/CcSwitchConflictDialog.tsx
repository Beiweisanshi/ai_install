import { useState } from "react";

import { closeOnBackdropMouseDown, useDialogKeyboard } from "../hooks/useDialogKeyboard";
import { t } from "../lib/strings";
import { theme } from "../styles/theme";

export interface CcSwitchConflictDialogProps {
  pids: number[];
  exePaths: string[];
  closing: boolean;
  onCloseAndContinue: () => void;
  onForceWrite: () => void;
  onCancel: () => void;
}

function CcSwitchConflictDialog({
  pids,
  exePaths,
  closing,
  onCloseAndContinue,
  onForceWrite,
  onCancel,
}: CcSwitchConflictDialogProps) {
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const dialogRef = useDialogKeyboard<HTMLDivElement>(true, onCancel);

  const pidLabel = pids.map((pid, i) => {
    const exe = exePaths[i] ?? "";
    return exe ? `${exe} (${pid})` : String(pid);
  }).join(", ");

  if (showForceConfirm) {
    return (
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4"
        onMouseDown={closeOnBackdropMouseDown(() => setShowForceConfirm(false))}
      >
        <div
          className="w-[440px] max-w-[90vw] rounded-lg border p-5"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          style={{ background: theme.card, borderColor: theme.warning, boxShadow: theme.cardShadowHover }}
        >
          <h2 className="text-base font-semibold" style={{ color: theme.textPrimary }}>
            {t("channel.ccSwitchForceConfirm")}
          </h2>
          <div className="mt-5 flex justify-end gap-2">
            <button
              className="btn btn-text rounded-lg px-3 py-2 text-sm"
              onClick={() => setShowForceConfirm(false)}
              style={{ color: theme.textSecondary }}
              type="button"
            >
              {t("common.back")}
            </button>
            <button
              className="btn rounded-lg px-4 py-2 text-sm font-semibold"
              onClick={onForceWrite}
              style={{ background: theme.warning, color: theme.textOnAccent }}
              type="button"
            >
              {t("channel.ccSwitchForceWrite")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 px-4"
      onMouseDown={closeOnBackdropMouseDown(onCancel)}
    >
      <div
        className="w-[520px] max-w-[90vw] rounded-lg border p-5"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{ background: theme.card, borderColor: theme.warning, boxShadow: theme.cardShadowHover }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold"
            style={{ background: theme.warningLight, color: theme.warning }}
            aria-hidden="true"
          >
            !
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
              {t("channel.ccSwitchDetectedTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.textSecondary }}>
              {t("channel.ccSwitchDetectedBody")}
            </p>
            {pids.length > 0 && (
              <p className="mt-2 text-xs font-mono" style={{ color: theme.textSecondary }}>
                {t("channel.ccSwitchPidsLabel")} {pidLabel}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="btn btn-text rounded-lg px-3 py-2 text-sm"
            onClick={onCancel}
            disabled={closing}
            style={{ color: theme.textSecondary }}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-text rounded-lg px-3 py-2 text-sm"
            onClick={() => setShowForceConfirm(true)}
            disabled={closing}
            style={{ color: theme.textSecondary }}
            type="button"
          >
            {t("channel.ccSwitchForceWrite")}
          </button>
          <button
            className="btn rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            disabled={closing}
            onClick={onCloseAndContinue}
            style={{ background: theme.accent, color: theme.textOnAccent }}
            type="button"
          >
            {closing ? t("channel.ccSwitchClosing") : t("channel.ccSwitchCloseAndContinue")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CcSwitchConflictDialog;
