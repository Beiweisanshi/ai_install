import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadSession } from "./storage";
import type { AuthSession } from "../types";

const SESSION_KEY = "zm_tools_auth_session";

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
