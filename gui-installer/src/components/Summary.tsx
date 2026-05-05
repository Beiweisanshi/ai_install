import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { formatText, t } from "../lib/strings";
import { theme } from "../styles/theme";
import type { DetectResult, InstallResult } from "../types";

interface SummaryProps {
  results: InstallResult[];
  tools: DetectResult[];
  onDone: () => void;
  onRetry: (toolNames: string[]) => void;
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function getResultState(result: InstallResult) {
  if (result.success) {
    return { color: theme.success, bg: theme.successLight, icon: "✓", label: t("summary.success") };
  }
  if (result.message.toLowerCase().includes("skip")) {
    return { color: theme.textMuted, bg: theme.bgTertiary, icon: "-", label: t("summary.skipped") };
  }
  return { color: theme.error, bg: theme.errorLight, icon: "!", label: t("summary.failed") };
}

function getVersionDisplay(result: InstallResult, detectInfo?: DetectResult) {
  const current = detectInfo?.current_version ?? result.version;
  const available = detectInfo?.available_version;
  if (current && available && current !== available) return `${current} -> ${available}`;
  return current ?? result.version ?? "-";
}

function Summary({ results, tools, onDone, onRetry }: SummaryProps) {
  const detectMap = new Map(tools.map((t) => [t.name, t]));
  const successCount = results.filter((r) => r.success).length;
  const skippedCount = results.filter(
    (r) => !r.success && r.message.toLowerCase().includes("skip"),
  ).length;
  const failedCount = results.length - successCount - skippedCount;
  const failedNames = results
    .filter((r) => !r.success && !r.message.toLowerCase().includes("skip"))
    .map((r) => r.name);
  const totalDuration = results.reduce((sum, result) => sum + result.duration_ms, 0);

  const [upgrading, setUpgrading] = useState<Set<string>>(new Set());
  const [upgradeResults, setUpgradeResults] = useState<Record<string, InstallResult>>({});

  const handleUpgrade = useCallback(async (toolName: string) => {
    setUpgrading((prev) => new Set([...prev, toolName]));
    try {
      const res = await invoke<InstallResult[]>("install_tools", { tools: [toolName] });
      if (res.length > 0) {
        setUpgradeResults((prev) => ({ ...prev, [toolName]: res[0] }));
      }
    } catch {
      setUpgradeResults((prev) => ({
        ...prev,
        [toolName]: { name: toolName, success: false, version: null, message: t("summary.upgradeFailed"), duration_ms: 0 },
      }));
    } finally {
      setUpgrading((prev) => {
        const next = new Set(prev);
        next.delete(toolName);
        return next;
      });
    }
  }, []);

  return (
    <section className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
          {t("summary.title")}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {successCount > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: theme.successLight, color: theme.success }}>
              {formatText("summary.successCount", { count: successCount })}
            </span>
          )}
          {failedCount > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: theme.errorLight, color: theme.error }}>
              {formatText("summary.failedCount", { count: failedCount })}
            </span>
          )}
          {skippedCount > 0 && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: theme.bgTertiary, color: theme.textMuted }}>
              {formatText("summary.skippedCount", { count: skippedCount })}
            </span>
          )}
          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: theme.bgTertiary, color: theme.textMuted }}>
            {formatText("summary.totalDuration", { duration: formatDuration(totalDuration) })}
          </span>
          {failedNames.length > 0 && (
            <button
              className="rounded-full px-3 py-1 text-xs font-semibold"
              onClick={() => onRetry(failedNames)}
              style={{ background: theme.errorLight, color: theme.error }}
              type="button"
            >
              {formatText("summary.retry", { count: failedNames.length })}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {results.map((result) => {
          const state = getResultState(result);
          const detectInfo = detectMap.get(result.name);
          const isUpgradable = detectInfo?.upgradable === true && result.success && !upgradeResults[result.name];
          const isUpgrading = upgrading.has(result.name);
          const upgraded = upgradeResults[result.name];

          return (
            <div
              className="flex items-center gap-3.5 rounded-lg border px-4 py-3"
              key={result.name}
              style={{
                background: theme.bgSecondary,
                borderColor: theme.cardBorder,
                boxShadow: theme.cardShadow,
              }}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: state.bg, color: state.color }}
              >
                {state.icon}
              </span>

              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold" style={{ color: theme.textPrimary }}>
                  {result.name}
                </h3>
                <p className="mt-0.5 text-xs" style={{ color: theme.textMuted }}>
                  {getVersionDisplay(result, detectInfo)}
                  <span className="mx-1.5">/</span>
                  {formatDuration(result.duration_ms)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isUpgradable && !isUpgrading && (
                  <button
                    className="rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 hover:-translate-y-px"
                    onClick={() => void handleUpgrade(result.name)}
                    style={{ background: theme.accentLight, color: theme.accent }}
                    type="button"
                  >
                    {t("summary.upgrade")}
                  </button>
                )}

                {isUpgrading && <span className="text-xs" style={{ color: theme.accent }}>{t("summary.upgrading")}</span>}

                {upgraded && (
                  <span className="text-xs font-medium" style={{ color: upgraded.success ? theme.success : theme.error }}>
                    {upgraded.success ? formatText("summary.upgraded", { version: upgraded.version ?? "" }) : t("summary.failed")}
                  </span>
                )}

                {result.message && (
                  <span
                    className="max-w-[360px] text-xs leading-tight"
                    style={{
                      color: result.success ? theme.textMuted : theme.error,
                      wordBreak: "break-word",
                    }}
                    title={result.message}
                  >
                    {result.message}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end pt-2">
        <button
          className="rounded-full px-6 py-2.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px"
          onClick={onDone}
          style={{
            background: theme.accent,
            color: theme.textOnAccent,
            boxShadow: "0 2px 8px rgba(196,112,75,0.3)",
          }}
          type="button"
        >
          {t("summary.done")}
        </button>
      </div>
    </section>
  );
}

export default Summary;
