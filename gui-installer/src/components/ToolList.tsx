import ToolCard from "./ToolCard";
import { theme } from "../styles/theme";
import type { DetectResult } from "../types";

interface ToolListProps {
  tools: DetectResult[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onStartInstall: () => void;
  installing: boolean;
  progress: Record<string, { percent: number; stage: string }>;
}

function getToolStatus(tool: DetectResult, installing: boolean, progressEntry?: { percent: number; stage: string }) {
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
  if (detailText === "Missing local package") return "缺少本地安装包";
  return detailText ?? undefined;
}

function ToolList({
  tools,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onStartInstall,
  installing,
  progress,
}: ToolListProps) {
  const installableTools = tools.filter((tool) => tool.installable);
  const allSelected = installableTools.length > 0 && selected.size === installableTools.length;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: theme.textPrimary }}>
              AI 工具安装器
            </h1>
            <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
              选择要安装或升级的工具
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150"
              onClick={onSelectAll}
              style={{
                background: allSelected ? theme.accentLight : "transparent",
                color: allSelected ? theme.accent : theme.textMuted,
              }}
              type="button"
            >
              全选
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150"
              onClick={onDeselectAll}
              style={{
                color: theme.textMuted,
              }}
              type="button"
            >
              清空
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div
          className="mt-3 flex items-center gap-4 text-xs"
          style={{ color: theme.textMuted }}
        >
          <span>{tools.length} 个工具</span>
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{
              background: selected.size > 0 ? theme.accentLight : theme.bgTertiary,
              color: selected.size > 0 ? theme.accent : theme.textMuted,
            }}
          >
            已选 {selected.size}
          </span>
        </div>
      </div>

      {/* Tool list */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {tools.map((tool) => {
          const progressEntry = progress[tool.name];

          return (
            <ToolCard
              key={tool.name}
              availableVersion={tool.available_version ?? undefined}
              checked={selected.has(tool.name)}
              currentVersion={tool.current_version ?? undefined}
              detailText={tool.installable ? undefined : formatDetailText(tool.unavailable_reason)}
              disabled={installing || !tool.installable}
              name={tool.name}
              onToggle={() => onToggle(tool.name)}
              progress={progressEntry?.percent}
              status={getToolStatus(tool, installing, progressEntry)}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs" style={{ color: theme.textMuted }}>
          缺少安装包的工具不可选择
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
          {installing ? "安装中..." : "开始安装"}
        </button>
      </div>
    </section>
  );
}

export default ToolList;
