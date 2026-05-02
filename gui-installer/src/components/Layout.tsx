import type { PropsWithChildren } from "react";

import AppVersionBanner from "./AppVersionBanner";
import { theme } from "../styles/theme";
import type { AppVersionInfo } from "../types";

interface LayoutProps extends PropsWithChildren {
  appVersionInfo?: AppVersionInfo | null;
}

function Layout({ children, appVersionInfo }: LayoutProps) {
  return (
    <main
      className="flex h-screen w-full items-center justify-center overflow-hidden"
      style={{ background: theme.bgPrimary }}
    >
      <div
        className="flex flex-col gap-4 p-6"
        style={{
          color: theme.textPrimary,
          height: 700,
          width: 900,
        }}
      >
        <div className="flex min-h-7 items-center justify-end">
          {appVersionInfo ? <AppVersionBanner versionInfo={appVersionInfo} /> : null}
        </div>

        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </main>
  );
}

export default Layout;
