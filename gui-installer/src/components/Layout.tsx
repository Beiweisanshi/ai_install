import type { PropsWithChildren } from "react";

import AppVersionBanner from "./AppVersionBanner";
import { theme } from "../styles/theme";
import type { AppVersionInfo } from "../types";

interface LayoutProps extends PropsWithChildren {
  appVersionInfo?: AppVersionInfo | null;
}

function Layout({ children, appVersionInfo }: LayoutProps) {
  return (
    <main className="flex h-screen w-full items-center justify-center overflow-hidden">
      <div
        className="flex h-full w-full max-w-[900px] flex-col gap-5 p-6"
        style={{
          color: theme.textPrimary,
          height: 700,
          width: 900,
        }}
      >
        {appVersionInfo ? <AppVersionBanner versionInfo={appVersionInfo} /> : null}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </main>
  );
}

export default Layout;
