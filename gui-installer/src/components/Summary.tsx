import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { theme } from "../styles/theme";
import type { DetectResult, InstallResult } from "../types";

interface SummaryProps {
  results: InstallResult[];
  tools: DetectResult[];
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function getResultState(result: InstallResult) {
  if (result.success) {
    return { color: theme.success, bg: theme.successLight, icon: "✓", label: "成功" };
  }
  if (result.message.toLowerCase().includes("skip")) {
    return { color: theme.textMuted, bg: theme.bgTertiary, icon: "—", label: "跳过" };
  }
  return { color: theme.error, bg: theme.errorLight, icon: "!", label: "失败" };
}

function getVersionDisplay(result: InstallResult, detectInfo?: DetectResult) {
  const current = detectInfo?.current_version ?? result.version;
  const available = detectInfo?.available_version;

  if (current && available && current !== available) return `${current} → ${available}`;
  return current ?? result.version ?? "—";
}

function Summary({ results, tools }: SummaryProps) {
  const detectMap = new Map(tools.map((t) => [t.name, t]));
  const successCount = results.filter((r) => r.success).length;
  const skippedCount = results.filter(
    (r) => !r.success && r.message.toLowerCase().includes("skip"),
  ).length;
  const failedCount = results.length - successCount - skippedCount;

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
        [toolName]: { name: toolName, success: false, version: null, message: "升级失败", duration_ms: 0 },
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
      {/* Header with stats */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
          安装完成
        </h1>
        <div className="mt-2 flex items-center gap-3">
          {successCount > 0 && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: theme.successLight, color: theme.success }}
            >
              {successCount} 成功
            </span>
          )}
          {failedCount > 0 && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: theme.errorLight, color: theme.error }}
            >
              {failedCount} 失败
            </span>
          )}
          {skippedCount > 0 && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: theme.bgTertiary, color: theme.textMuted }}
            >
              {skippedCount} 跳过
            </span>
          )}
        </div>
      </div>

      {/* Result list */}
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {results.map((result) => {
          const state = getResultState(result);
          const detectInfo = detectMap.get(result.name);
          const isUpgradable = detectInfo?.upgradable === true && result.success && !upgradeResults[result.name];
          const isUpgrading = upgrading.has(result.name);
          const upgraded = upgradeResults[result.name];

          return (
            <div
              className="flex items-center gap-3.5 rounded-xl border px-4 py-3"
              key={result.name}
              style={{
                background: theme.bgSecondary,
                borderColor: theme.cardBorder,
                boxShadow: theme.cardShadow,
              }}
            >
              {/* Status icon */}
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: state.bg, color: state.color }}
              >
                {state.icon}
              </span>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold" style={{ color: theme.textPrimary }}>
                  {result.name}
                </h3>
                <p className="mt-0.5 text-xs" style={{ color: theme.textMuted }}>
                  {getVersionDisplay(result, detectInfo)}
                  <span className="mx-1.5">·</span>
                  {formatDuration(result.duration_ms)}
                </p>
              </div>

              {/* Actions / status */}
              <div className="flex shrink-0 items-center gap-2">
                {isUpgradable && !isUpgrading && (
                  <button
                    className="rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 hover:-translate-y-px"
                    onClick={() => void handleUpgrade(result.name)}
                    style={{
                      background: theme.accentLight,
                      color: theme.accent,
                    }}
                    type="button"
                  >
                    升级
                  </button>
                )}

                {isUpgrading && (
                  <span className="text-xs" style={{ color: theme.accent }}>升级中...</span>
                )}

                {upgraded && (
                  <span
                    className="text-xs font-medium"
                    style={{ color: upgraded.success ? theme.success : theme.error }}
                  >
                    {upgraded.success ? `已升级 ${upgraded.version ?? ""}` : "失败"}
                  </span>
                )}

                {result.message && (
                  <span
                    className="max-w-[200px] truncate text-xs"
                    style={{ color: theme.textMuted }}
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

      {/* Footer */}
      <div className="flex items-center justify-end pt-2">
        <button
          className="rounded-full px-6 py-2.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px"
          onClick={() => window.location.reload()}
          style={{
            background: theme.accent,
            color: theme.textOnAccent,
            boxShadow: "0 2px 8px rgba(196,112,75,0.3)",
          }}
          type="button"
        >
          完成
        </button>
      </div>
    </section>
  );
}

export default Summary;
