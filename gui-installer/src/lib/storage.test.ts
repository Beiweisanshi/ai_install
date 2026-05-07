import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadRecentCwds, loadSession, pushRecentCwd } from "./storage";
import type { AuthSession } from "../types";

const SESSION_KEY = "zm_tools_auth_session";
const RECENT_CWDS_KEY = "zm_tools_recent_cwds";

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
