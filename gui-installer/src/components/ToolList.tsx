import { useEffect, useMemo, useRef, useState } from "react";

import ToolCard from "./ToolCard";
import { formatText, t } from "../lib/strings";
import { theme } from "../styles/theme";
import type { DetectResult } from "../types";

interface ToolListProps {
  tools: DetectResult[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartInstall: () => void;
  onBack: () => void;
  installing: boolean;
  progress: Record<string, { percent: number; stage: string }>;
  logs?: Record<string, string[]>;
}

function getToolStatus(
  tool: DetectResult,
  installing: boolean,
  progressEntry?: { percent: number; stage: string },
) {
  if (installing && progressEntry) {
    if (progressEntry.percent >= 100) {
      return progressEntry.stage === "failed" ? "failed" : "success";
    }
    return "installing";
  }

  if (!tool.installable) return "unavailable";
  if (tool.upgradable) return "upgradable";
  return tool.installed ? "installed" : "not_installed";
}

function formatDetailText(detailText?: string | null) {
  if (detailText === "Missing local package") return t("install.missingLocalPackage");
  return detailText ?? undefined;
}

function ToolList({
  tools,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onStartInstall,
  onBack,
  installing,
  progress,
  logs,
}: ToolListProps) {
  const installableTools = tools.filter((tool) => tool.installable && (!tool.installed || tool.upgradable));
  const allSelected = installableTools.length > 0 && selected.size === installableTools.length;
  const [expandedLogTool, setExpandedLogTool] = useState<string | null>(null);
  const mergedLogs = useMemo(() => mergeLogs(logs), [logs]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
              {t("install.title")}
            </h1>
            <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
              {t("install.description")}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150"
              disabled={installing}
              onClick={onBack}
              style={{ color: theme.textMuted }}
              type="button"
            >
              {t("common.back")}
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150"
              onClick={onSelectAll}
              style={{
                background: allSelected ? theme.accentLight : "transparent",
                color: allSelected ? theme.accent : theme.textMuted,
              }}
              type="button"
            >
              {t("install.selectAll")}
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150"
              onClick={onDeselectAll}
              style={{ color: theme.textMuted }}
              type="button"
            >
              {t("install.clear")}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 text-xs" style={{ color: theme.textMuted }}>
          <span>{formatText("install.componentCount", { count: tools.length })}</span>
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{
              background: selected.size > 0 ? theme.accentLight : theme.bgTertiary,
              color: selected.size > 0 ? theme.accent : theme.textMuted,
            }}
          >
            {formatText("install.selectedCount", { count: selected.size })}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {tools.map((tool) => {
          const progressEntry = progress[tool.name];
          const toolLogs = logs?.[tool.name] ?? [];
          const status = getToolStatus(tool, installing, progressEntry);
          const showLogToggle = installing && status === "installing" && toolLogs.length > 0;
          const canSelect = tool.installable && (!tool.installed || tool.upgradable);

          return (
            <div className="relative" key={tool.name}>
              <ToolCard
                availableVersion={tool.available_version ?? undefined}
                checked={selected.has(tool.name)}
                currentVersion={tool.current_version ?? undefined}
                detailText={tool.installable ? undefined : formatDetailText(tool.unavailable_reason)}
                disabled={installing || !canSelect}
                name={tool.name}
                onToggle={() => onToggle(tool.name)}
                progress={progressEntry?.percent}
                status={status}
              />
              {showLogToggle && (
                <button
                  className="absolute right-3 top-3 rounded-md px-2 py-1 text-xs font-medium"
                  onClick={() => setExpandedLogTool((current) => (current === tool.name ? null : tool.name))}
                  style={{ background: theme.bgTertiary, color: theme.textSecondary }}
                  type="button"
                >
                  {t("install.details")} {expandedLogTool === tool.name ? "▴" : "▾"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {installing && mergedLogs.length > 0 && (
        <InstallLogsPane
          lines={expandedLogTool ? (logs?.[expandedLogTool] ?? []).map((line) => `${expandedLogTool}: ${line}`) : mergedLogs}
          title={expandedLogTool ? formatText("install.toolLogsTitle", { toolName: expandedLogTool }) : t("install.logsTitle")}
        />
      )}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs" style={{ color: theme.textMuted }}>
          {t("install.disabledHint")}
        </p>

        <button
          className="rounded-full px-6 py-2.5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          disabled={installing || selected.size === 0}
          onClick={onStartInstall}
          style={{
            background: theme.accent,
            color: theme.textOnAccent,
            boxShadow: installing || selected.size === 0
              ? "none"
              : "0 2px 8px rgba(196,112,75,0.3)",
          }}
          type="button"
        >
          {installing ? t("install.installing") : t("install.start")}
        </button>
      </div>
    </section>
  );
}

function InstallLogsPane({ title, lines }: { title: string; lines: string[] }) {
  const ref = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="rounded-lg border p-3" style={{ background: theme.bgSecondary, borderColor: theme.border }}>
      <div className="mb-2 text-xs font-semibold" style={{ color: theme.textPrimary }}>
        {title}
      </div>
      <pre
        className="max-h-64 overflow-auto text-xs font-mono"
        ref={ref}
        style={{
          color: theme.textSecondary,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {lines.slice(-300).join("\n")}
      </pre>
    </div>
  );
}

function mergeLogs(logs?: Record<string, string[]>) {
  if (!logs) return [];
  return Object.entries(logs).flatMap(([tool, lines]) => lines.map((line) => `${tool}: ${line}`));
}

export default ToolList;
