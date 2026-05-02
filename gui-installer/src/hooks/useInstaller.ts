import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AppVersionInfo,
  AppPhase,
  BlockingState,
  DetectResult,
  InstallResult,
  ProgressEvent,
  RunningProc,
  LaunchMode,
} from "../types";
import { loadDetectCache, saveDetectCache } from "../lib/storage";

const REQUIRED_TOOLS = ["Git", "Node.js"];

const NPM_PKG_BY_TOOL: Record<string, string> = {
  "Claude CLI": "@anthropic-ai/claude-code",
  "Codex CLI": "@openai/codex",
  "Gemini CLI": "@google/gemini-cli",
  OpenCode: "opencode-ai",
};

const MAX_LOG_LINES_PER_TOOL = 500;

// Must stay in sync with the backend `InstallerError::Blocked` user_message
// prefix in `src-tauri/src/installer/npm.rs`.
const BLOCKED_MESSAGE_PREFIX = "Close all running";
const BLOCKED_MESSAGE_SUFFIX_RE = /windows before upgrading/i;

function isBlockedMessage(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return msg.startsWith(BLOCKED_MESSAGE_PREFIX) && BLOCKED_MESSAGE_SUFFIX_RE.test(msg);
}

export function useInstaller() {
  const cachedTools = loadDetectCache();
  const [phase, setPhase] = useState<AppPhase>(() =>
    cachedTools ? phaseForDetectedTools(cachedTools) : "detecting",
  );
  const [tools, setTools] = useState<DetectResult[]>(() => cachedTools ?? []);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultInstallSelection(cachedTools ?? []).map((tool) => tool.name)),
  );
  const [progress, setProgress] = useState<Record<string, ProgressEvent>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<InstallResult[]>([]);
  const [appVersionInfo, setAppVersionInfo] = useState<AppVersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<BlockingState | null>(null);

  const detectTools = useCallback(async (background = false) => {
    if (!background) {
      setPhase("detecting");
    }
    setError(null);

    try {
      const detected = await invoke<DetectResult[]>("detect_tools");
      saveDetectCache(detected);
      setTools(detected);

      const defaultSelected = new Set(
        defaultInstallSelection(detected).map((tool) => tool.name),
      );

      setSelected(defaultSelected);
      setPhase(phaseForDetectedTools(detected));
    } catch (e) {
      setError(String(e));
      if (!background) {
        setPhase("selecting");
      }
    }
  }, []);

  const startDetect = useCallback(async () => {
    await detectTools(false);
  }, [detectTools]);

  const toggleTool = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }

      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(tools.filter((tool) => tool.installable && (!tool.installed || tool.upgradable)).map((tool) => tool.name)));
  }, [tools]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const runInstall = useCallback(async (toolNames: string[]) => {
    setPhase("installing");
    setProgress({});
    setLogs({});
    setError(null);
    setBlocking(null);

    try {
      const installResults = await invoke<InstallResult[]>("install_tools", {
        tools: toolNames,
      });

      setResults(installResults);

      try {
        const refreshed = await invoke<DetectResult[]>("detect_tools");
        saveDetectCache(refreshed);
        setTools(refreshed);
      } catch {
        // Non-critical: summary still works with stale detect data
      }

      const blocked = installResults.find(
        (r) => !r.success && isBlockedMessage(r.message) && NPM_PKG_BY_TOOL[r.name],
      );
      if (blocked) {
        try {
          const procs = await invoke<RunningProc[]>("list_blocking_processes", {
            pkg: NPM_PKG_BY_TOOL[blocked.name],
          });
          setBlocking({
            toolName: blocked.name,
            pkg: NPM_PKG_BY_TOOL[blocked.name],
            processes: procs,
          });
          setPhase("selecting");
          return;
        } catch {
          // Fall through to summary if we couldn't list.
        }
      }

      const failed = installResults.filter((result) => !result.success);
      setError(failed.length > 0 ? `${failed.length} 个组件安装失败，请查看安装日志或重试。` : null);
      setPhase("dashboard");
    } catch (e) {
      setError(String(e));
      setPhase("dashboard");
    }
  }, []);

  const startInstall = useCallback(async () => {
    await runInstall(Array.from(selected));
  }, [runInstall, selected]);

  const openInstall = useCallback((toolName?: string) => {
    if (toolName) {
      setSelected(new Set([toolName]));
    } else {
      setSelected(new Set(defaultInstallSelection(tools).map((tool) => tool.name)));
    }
    setPhase("selecting");
  }, [tools]);

  const goDashboard = useCallback(() => {
    setPhase("dashboard");
  }, []);

  const launchTool = useCallback(async (tool: string, mode: LaunchMode) => {
    try {
      await invoke("launch_ai_tool", { tool, mode });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const killBlockingAndRetry = useCallback(async () => {
    if (!blocking) return;
    const pids = blocking.processes.map((p) => p.pid);
    try {
      await invoke<number>("kill_blocking_processes", { pids });
    } catch (e) {
      setError(String(e));
      return;
    }
    await runInstall([blocking.toolName]);
  }, [blocking, runInstall]);

  const retryBlocking = useCallback(async () => {
    if (!blocking) return;
    await runInstall([blocking.toolName]);
  }, [blocking, runInstall]);

  const dismissBlocking = useCallback(() => {
    setBlocking(null);
  }, []);

  useEffect(() => {
    void detectTools(Boolean(cachedTools));
  }, [detectTools]);

  useEffect(() => {
    let cancelled = false;

    const loadAppVersion = async () => {
      try {
        const versionInfo = await invoke<AppVersionInfo>("get_app_version_info");
        if (!cancelled) {
          setAppVersionInfo(versionInfo);
        }
      } catch {
        if (!cancelled) {
          setAppVersionInfo(null);
        }
      }
    };

    void loadAppVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<ProgressEvent>("install-progress", (event) => {
      const payload = event.payload;
      setProgress((prev) => {
        const existing = prev[payload.tool_name];
        if (
          existing &&
          existing.stage === payload.stage &&
          existing.percent === payload.percent &&
          existing.message === payload.message
        ) {
          return prev;
        }
        return { ...prev, [payload.tool_name]: payload };
      });
      // Streamed install output lines (npm stdout/stderr) arrive with
      // percent=50, stage="installing" — see installer/npm.rs spawn_log_reader.
      if (payload.stage === "installing" && payload.percent === 50 && payload.message) {
        setLogs((prev) => {
          const existing = prev[payload.tool_name] ?? [];
          if (existing[existing.length - 1] === payload.message) return prev;
          const appended = [...existing, payload.message];
          const trimmed = appended.length > MAX_LOG_LINES_PER_TOOL
            ? appended.slice(-MAX_LOG_LINES_PER_TOOL)
            : appended;
          return { ...prev, [payload.tool_name]: trimmed };
        });
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return {
    phase,
    tools,
    selected,
    progress,
    logs,
    results,
    appVersionInfo,
    error,
    blocking,
    toggleTool,
    selectAll,
    deselectAll,
    startDetect,
    openInstall,
    goDashboard,
    startInstall,
    launchTool,
    killBlockingAndRetry,
    retryBlocking,
    dismissBlocking,
  };
}

function hasMissingRequiredTools(tools: DetectResult[]): boolean {
  return tools.some((tool) => REQUIRED_TOOLS.includes(tool.name) && !tool.installed);
}

function phaseForDetectedTools(tools: DetectResult[]): AppPhase {
  return hasMissingRequiredTools(tools) ? "selecting" : "dashboard";
}

function defaultInstallSelection(tools: DetectResult[]): DetectResult[] {
  const missingRequired = tools.filter(
    (tool) => REQUIRED_TOOLS.includes(tool.name) && !tool.installed && tool.installable,
  );
  if (missingRequired.length > 0) return missingRequired;

  return tools.filter((tool) => tool.installable && (!tool.installed || tool.upgradable));
}
