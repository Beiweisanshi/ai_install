import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadLastConfirmedLaunch,
  loadRecentCwds,
  loadSession,
  matchesLastConfirmedLaunch,
  pushRecentCwd,
  saveLastConfirmedLaunch,
} from "./storage";
import type { AuthSession } from "../types";

const SESSION_KEY = "zm_tools_auth_session";
const RECENT_CWDS_KEY = "zm_tools_recent_cwds";
const LAST_CONFIRMED_LAUNCH_KEY = "zm_tools_last_confirmed_launch";

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    access_token: "legacy-access",
    refresh_token: "legacy-refresh",
    token_type: "Bearer",
    user: {
      id: 1,
      email: "user@example.com",
    },
    ...overrides,
  };
}

describe("storage session migration", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(invoke).mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("migrates a legacy remembered localStorage session into secure storage", async () => {
    const legacy = session({ expires_at: Date.now() + 60_000 });
    localStorage.setItem(SESSION_KEY, JSON.stringify(legacy));
    vi.mocked(invoke).mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);

    await expect(loadSession()).resolves.toEqual(legacy);

    expect(invoke).toHaveBeenNthCalledWith(1, "secure_session_get");
    expect(invoke).toHaveBeenNthCalledWith(2, "secure_session_set", {
      session: JSON.stringify(legacy),
    });
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe("pushRecentCwd", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("ignores empty / nullish input and returns the existing list", () => {
    localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify(["D:\\a"]));
    expect(pushRecentCwd("")).toEqual(["D:\\a"]);
    expect(pushRecentCwd("   ")).toEqual(["D:\\a"]);
    expect(pushRecentCwd(null)).toEqual(["D:\\a"]);
    expect(pushRecentCwd(undefined)).toEqual(["D:\\a"]);
    expect(loadRecentCwds()).toEqual(["D:\\a"]);
  });

  it("prepends new paths and de-duplicates by case-insensitive match", () => {
    pushRecentCwd("D:\\a");
    pushRecentCwd("D:\\b");
    expect(loadRecentCwds()).toEqual(["D:\\b", "D:\\a"]);

    // Re-pushing the same path (different casing) moves it to the front but
    // preserves the original casing.
    pushRecentCwd("d:\\A");
    expect(loadRecentCwds()).toEqual(["D:\\a", "D:\\b"]);
  });

  it("caps the MRU list at 5 entries", () => {
    for (const path of ["D:\\1", "D:\\2", "D:\\3", "D:\\4", "D:\\5", "D:\\6"]) {
      pushRecentCwd(path);
    }
    const list = loadRecentCwds();
    expect(list).toHaveLength(5);
    expect(list[0]).toBe("D:\\6");
    // The oldest entry must have rolled off.
    expect(list).not.toContain("D:\\1");
  });

  it("trims whitespace before persisting", () => {
    pushRecentCwd("  D:\\with-space  ");
    expect(loadRecentCwds()).toEqual(["D:\\with-space"]);
  });
});

describe("last-confirmed launch persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty map when storage is empty", () => {
    expect(loadLastConfirmedLaunch()).toEqual({});
  });

  it("returns an empty map when storage is corrupt JSON (and does not throw)", () => {
    localStorage.setItem(LAST_CONFIRMED_LAUNCH_KEY, "not-json");
    expect(loadLastConfirmedLaunch()).toEqual({});
  });

  it("filters unknown toolIds and entries with wrong field types", () => {
    localStorage.setItem(
      LAST_CONFIRMED_LAUNCH_KEY,
      JSON.stringify({
        codex: { modeId: "codex.dangerous", cwd: "D:\\a" },
        bogus: { modeId: "bogus.x", cwd: null },
        claude: { modeId: 123, cwd: null },
        gemini: { modeId: "gemini.yolo", cwd: 42 },
        opencode: "not-an-object",
      }),
    );
    expect(loadLastConfirmedLaunch()).toEqual({
      codex: { modeId: "codex.dangerous", cwd: "D:\\a" },
    });
  });

  it("save + matches round-trip: equal returns true; any differing field returns false", () => {
    saveLastConfirmedLaunch("codex", { modeId: "codex.dangerous", cwd: "D:\\proj" });

    expect(matchesLastConfirmedLaunch("codex", "codex.dangerous", "D:\\proj")).toBe(true);
    expect(matchesLastConfirmedLaunch("codex", "codex.dangerous", "D:\\other")).toBe(false);
    expect(matchesLastConfirmedLaunch("codex", "codex.default", "D:\\proj")).toBe(false);
    expect(matchesLastConfirmedLaunch("claude", "codex.dangerous", "D:\\proj")).toBe(false);
  });

  it("treats cwd:null as strictly distinct from cwd:''", () => {
    saveLastConfirmedLaunch("codex", { modeId: "codex.dangerous", cwd: null });
    expect(matchesLastConfirmedLaunch("codex", "codex.dangerous", null)).toBe(true);
    expect(matchesLastConfirmedLaunch("codex", "codex.dangerous", "")).toBe(false);
  });
});
