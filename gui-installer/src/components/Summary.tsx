import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { theme } from "../styles/theme";
import type { DetectResult, InstallResult } from "../types";

interface SummaryProps {
  results: InstallResult[];
  tools: DetectResult[];
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function getResultState(result: InstallResult) {
  if (result.success) {
    return {
      color: theme.success,
      icon: "✓",
      label: "成功",
    };
  }

  if (result.message.toLowerCase().includes("skip")) {
    return {
      color: theme.textMuted,
      icon: "-",
      label: "跳过",
    };
  }

  return {
    color: theme.error,
    icon: "!",
    label: "失败",
  };
}

function getVersionDisplay(result: InstallResult, detectInfo?: DetectResult) {
  const currentVersion = detectInfo?.current_version ?? result.version;
  const availableVersion = detectInfo?.available_version;

  if (currentVersion && availableVersion && currentVersion !== availableVersion) {
    return `${currentVersion} → ${availableVersion}`;
  }

  return currentVersion ?? result.version ?? "-";
}

function Summary({ results, tools }: SummaryProps) {
  const detectMap = new Map(tools.map((tool) => [tool.name, tool]));
  const successCount = results.filter((result) => result.success).length;
  const skippedCount = results.filter(
    (result) => !result.success && result.message.toLowerCase().includes("skip"),
  ).length;
  const failedCount = results.length - successCount - skippedCount;

  const [upgrading, setUpgrading] = useState<Set<string>>(new Set());
  const [upgradeResults, setUpgradeResults] = useState<Record<string, InstallResult>>({});

  const handleUpgrade = useCallback(async (toolName: string) => {
    setUpgrading((prev) => new Set([...prev, toolName]));
    try {
      const upgradeResult = await invoke<InstallResult[]>("install_tools", {
        tools: [toolName],
      });
      if (upgradeResult.length > 0) {
        setUpgradeResults((prev) => ({
          ...prev,
          [toolName]: upgradeResult[0],
        }));
      }
    } catch {
      setUpgradeResults((prev) => ({
        ...prev,
        [toolName]: {
          name: toolName,
          success: false,
          version: null,
          message: "升级失败",
          duration_ms: 0,
        },
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
    <section className="flex h-full flex-col gap-5">
      <div
        className="rounded-2xl border p-5"
        style={{
          background: theme.card,
          borderColor: theme.cardBorder,
          borderRadius: theme.radius,
        }}
      >
        <h2 className="text-2xl font-semibold text-white">安装结果</h2>
        <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
          已汇总每个工具的安装状态、版本和用时。
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {results.map((result) => {
          const state = getResultState(result);
          const detectInfo = detectMap.get(result.name);
          const isUpgradable = detectInfo?.upgradable === true && result.success && !upgradeResults[result.name];
          const isUpgrading = upgrading.has(result.name);
          const upgraded = upgradeResults[result.name];

          return (
            <div
              className="flex items-center justify-between gap-4 rounded-2xl border p-4"
              key={result.name}
              style={{
                background: theme.card,
                borderColor: theme.cardBorder,
                borderRadius: theme.radius,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={{
                      background: `${state.color}22`,
                      color: state.color,
                    }}
                  >
                    {state.icon}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">{result.name}</h3>
                    <p className="text-sm" style={{ color: theme.textSecondary }}>
                      {state.label} / {getVersionDisplay(result, detectInfo)} / {formatDuration(result.duration_ms)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {isUpgradable && !isUpgrading && (
                  <button
                    className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition duration-200 hover:-translate-y-0.5 hover:brightness-110"
                    onClick={() => void handleUpgrade(result.name)}
                    style={{
                      background: theme.accent,
                      borderColor: "transparent",
                      color: "#fff",
                    }}
                    type="button"
                  >
                    升级
                  </button>
                )}

                {isUpgrading && (
                  <span className="shrink-0 text-xs" style={{ color: theme.accent }}>
                    升级中...
                  </span>
                )}

                {upgraded && (
                  <span
                    className="shrink-0 text-xs font-medium"
                    style={{ color: upgraded.success ? theme.success : theme.error }}
                  >
                    {upgraded.success ? `已升级 ${upgraded.version ?? ""}` : "升级失败"}
                  </span>
                )}

                <p
                  className="max-w-[340px] break-words text-right text-sm"
                  style={{ color: theme.textMuted }}
                  title={result.message}
                >
                  {result.message}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="flex items-center justify-between rounded-2xl border p-4"
        style={{
          background: theme.card,
          borderColor: theme.cardBorder,
          borderRadius: theme.radius,
        }}
      >
        <p className="text-sm" style={{ color: theme.textSecondary }}>
          成功 {successCount} / 失败 {failedCount} / 跳过 {skippedCount}
        </p>

        <button
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-110"
          onClick={() => window.location.reload()}
          style={{ background: theme.accent }}
          type="button"
        >
          完成
        </button>
      </div>
    </section>
  );
}

export default Summary;
