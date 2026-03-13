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

  if (!tool.installable) {
    return "unavailable";
  }

  if (tool.upgradable) {
    return "upgradable";
  }

  return tool.installed ? "installed" : "not_installed";
}

function formatStage(stage: string) {
  const stageMap: Record<string, string> = {
    detecting: "检测中",
    installing: "安装中",
    verifying: "校验中",
    done: "已完成",
    failed: "失败",
  };

  return stageMap[stage] ?? stage;
}

function formatDetailText(detailText?: string | null) {
  if (detailText === "Missing local package") {
    return "缺少本地安装包";
  }

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
    <section className="flex h-full min-h-0 flex-col gap-5">
      <div
        className="rounded-2xl border p-5 backdrop-blur-sm"
        style={{
          background: theme.card,
          borderColor: theme.cardBorder,
          borderRadius: theme.radius,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em]" style={{ color: theme.textMuted }}>
              本地包安装器
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white">AI 工具安装器</h1>
            <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
              选择要安装或升级的工具，然后开始批量安装。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full border px-4 py-2 text-sm font-medium transition duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/8"
              onClick={onSelectAll}
              style={{
                background: allSelected ? "rgba(255,255,255,0.12)" : theme.card,
                borderColor: theme.cardBorder,
                color: theme.textPrimary,
              }}
              type="button"
            >
              全选
            </button>
            <button
              className="rounded-full border px-4 py-2 text-sm font-medium transition duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/8"
              onClick={onDeselectAll}
              style={{
                background: theme.card,
                borderColor: theme.cardBorder,
                color: theme.textSecondary,
              }}
              type="button"
            >
              清空
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm" style={{ color: theme.textSecondary }}>
        <span>工具总数 {tools.length}</span>
        <span>已选择 {selected.size}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {tools.map((tool) => {
          const progressEntry = progress[tool.name];

          return (
            <div key={tool.name}>
              <ToolCard
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

              {installing && progressEntry?.stage ? (
                <p className="mt-2 px-2 text-xs" style={{ color: theme.textMuted }}>
                  {formatStage(progressEntry.stage)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        className="mt-auto flex items-center justify-between rounded-2xl border p-4"
        style={{
          background: theme.card,
          borderColor: theme.cardBorder,
          borderRadius: theme.radius,
        }}
      >
        <p className="text-sm" style={{ color: theme.textSecondary }}>
          缺少本地安装包的工具会继续显示，但默认不能选择。
        </p>

        <button
          className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          disabled={installing || selected.size === 0}
          onClick={onStartInstall}
          style={{ background: theme.accent }}
          type="button"
        >
          {installing ? "安装中..." : "开始安装"}
        </button>
      </div>
    </section>
  );
}

export default ToolList;
