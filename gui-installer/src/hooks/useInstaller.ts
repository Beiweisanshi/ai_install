import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AppVersionInfo,
  ConfigEntry,
  DetectResult,
  InstallResult,
  ProgressEvent,
} from "../types";

type Phase = "detecting" | "selecting" | "installing" | "configuring" | "summary";

export function useInstaller() {
  const [phase, setPhase] = useState<Phase>("detecting");
  const [tools, setTools] = useState<DetectResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, ProgressEvent>>({});
  const [results, setResults] = useState<InstallResult[]>([]);
  const [appVersionInfo, setAppVersionInfo] = useState<AppVersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const startInstall = useCallback(async () => {
    setPhase("installing");
    setProgress({});
    setError(null);

    try {
      const installResults = await invoke<InstallResult[]>("install_tools", {
        tools: Array.from(selected),
      });

      setResults(installResults);

      // Re-detect tools after install to get updated version info
      try {
        const refreshed = await invoke<DetectResult[]>("detect_tools");
        setTools(refreshed);
      } catch {
        // Non-critical: summary still works with stale detect data
      }

      setPhase("configuring");
    } catch (e) {
      setError(String(e));
      setPhase("configuring");
    }
  }, [selected]);

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
      setProgress((prev) => ({
        ...prev,
        [event.payload.tool_name]: event.payload,
      }));
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
    results,
    appVersionInfo,
    error,
    toggleTool,
    selectAll,
    deselectAll,
    startDetect,
    startInstall,
    saveConfig,
    skipConfig,
  };
}
