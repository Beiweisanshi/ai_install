import type { PropsWithChildren } from "react";

import AppVersionBanner from "./AppVersionBanner";
import { t } from "../lib/strings";
import { theme } from "../styles/theme";
import type { AppVersionInfo } from "../types";

interface LayoutProps extends PropsWithChildren {
  appVersionInfo?: AppVersionInfo | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

function Layout({ children, appVersionInfo, darkMode, onToggleDarkMode }: LayoutProps) {
  return (
    <main
      className="flex h-screen w-full items-center justify-center overflow-hidden"
      style={{ background: theme.bgPrimary }}
    >
      <div
        className="flex h-full w-full max-w-[1100px] flex-col gap-4 p-6"
        style={{
          color: theme.textPrimary,
        }}
      >
        <div className="flex min-h-7 items-center justify-between">
          <div className="flex items-center gap-2">
            <img alt="" className="h-6 w-6" src="/assets/logo.svg" />
            <span className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
              {t("app.name")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-secondary rounded-lg px-2 py-1 text-xs"
              onClick={onToggleDarkMode}
              style={{ background: theme.bgTertiary, color: theme.textSecondary }}
              type="button"
              title={darkMode ? t("app.theme.toLight") : t("app.theme.toDark")}
            >
              {darkMode ? t("app.theme.light") : t("app.theme.dark")}
            </button>
            {appVersionInfo ? <AppVersionBanner versionInfo={appVersionInfo} /> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </main>
  );
}

export default Layout;
