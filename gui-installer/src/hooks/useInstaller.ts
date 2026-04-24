import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AppVersionInfo,
  BlockingState,
  ConfigEntry,
  DetectResult,
  InstallResult,
  ProgressEvent,
  RunningProc,
} from "../types";

type Phase = "detecting" | "selecting" | "installing" | "configuring" | "summary";

const CONFIGURABLE_TOOLS = ["Claude CLI", "Codex", "Codex CLI", "Gemini", "Gemini CLI"];

const NPM_PKG_BY_TOOL: Record<string, string> = {
  "Claude CLI": "@anthropic-ai/claude-code",
  "Codex CLI": "@openai/codex",
  "Gemini CLI": "@google/gemini-cli",
};

const MAX_LOG_LINES_PER_TOOL = 500;

function hasConfigurableSuccess(results: InstallResult[]): boolean {
  return results.some(
    (r) => r.success && CONFIGURABLE_TOOLS.some((name) => r.name.includes(name)),
  );
}

// Must stay in sync with the backend `InstallerError::Blocked` user_message
// prefix in `src-tauri/src/installer/npm.rs`.
const BLOCKED_MESSAGE_PREFIX = "Close all running";
const BLOCKED_MESSAGE_SUFFIX_RE = /windows before upgrading/i;

function isBlockedMessage(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return msg.startsWith(BLOCKED_MESSAGE_PREFIX) && BLOCKED_MESSAGE_SUFFIX_RE.test(msg);
}

export function useInstaller() {
  const [phase, setPhase] = useState<Phase>("detecting");
  const [tools, setTools] = useState<DetectResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, ProgressEvent>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<InstallResult[]>([]);
  const [appVersionInfo, setAppVersionInfo] = useState<AppVersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<BlockingState | null>(null);

  const startDetect = useCallback(async () => {
    setPhase("detecting");
    setError(null);

    try {
      const detected = await invoke<DetectResult[]>("detect_tools");
      setTools(detected);

      const defaultSelected = new Set(
        detected
          .filter((tool) => tool.installable && (!tool.installed || tool.upgradable))
          .map((tool) => tool.name),
      );

      setSelected(defaultSelected);
      setPhase("selecting");
    } catch (e) {
      setError(String(e));
      setPhase("selecting");
    }
  }, []);

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
    setSelected(new Set(tools.filter((tool) => tool.installable).map((tool) => tool.name)));
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

      setPhase(hasConfigurableSuccess(installResults) ? "configuring" : "summary");
    } catch (e) {
      setError(String(e));
      setPhase("summary");
    }
  }, []);

  const startInstall = useCallback(async () => {
    await runInstall(Array.from(selected));
  }, [runInstall, selected]);

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

  const saveConfig = useCallback(async (entries: ConfigEntry[]) => {
    try {
      await invoke("save_config", { entries });
      setPhase("summary");
    } catch (e) {
      setError(String(e));
      setPhase("summary");
    }
  }, []);

  const skipConfig = useCallback(() => {
    setPhase("summary");
  }, []);

  useEffect(() => {
    void startDetect();
  }, [startDetect]);

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
    startInstall,
    saveConfig,
    skipConfig,
    killBlockingAndRetry,
    retryBlocking,
    dismissBlocking,
  };
}
