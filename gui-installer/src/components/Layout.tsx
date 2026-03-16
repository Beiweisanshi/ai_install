import type { PropsWithChildren } from "react";

import AppVersionBanner from "./AppVersionBanner";
import { theme } from "../styles/theme";
import type { AppVersionInfo } from "../types";

type Phase = "detecting" | "selecting" | "installing" | "configuring" | "summary";

interface LayoutProps extends PropsWithChildren {
  appVersionInfo?: AppVersionInfo | null;
  phase?: Phase;
}

const STEPS: { phase: Phase[]; label: string }[] = [
  { phase: ["detecting", "selecting", "installing"], label: "选择工具" },
  { phase: ["configuring"], label: "配置凭据" },
  { phase: ["summary"], label: "完成" },
];

function StepIndicator({ currentPhase }: { currentPhase: Phase }) {
  const currentIndex = STEPS.findIndex((step) => step.phase.includes(currentPhase));

  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, index) => {
        const isActive = index === currentIndex;
        const isDone = index < currentIndex;

        return (
          <div key={step.label} className="flex items-center gap-2">
            {index > 0 && (
              <div
                className="h-px w-6"
                style={{ background: isDone ? theme.accent : theme.border }}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{
                  background: isActive ? theme.accent : isDone ? theme.accent : theme.bgTertiary,
                  color: isActive || isDone ? theme.textOnAccent : theme.textMuted,
                }}
              >
                {isDone ? "✓" : index + 1}
              </div>
              <span
                className="text-xs font-medium"
                style={{ color: isActive ? theme.textPrimary : theme.textMuted }}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Layout({ children, appVersionInfo, phase = "detecting" }: LayoutProps) {
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
        {/* Top bar: step indicator + version */}
        <div className="flex items-center justify-between">
          <StepIndicator currentPhase={phase} />
          {appVersionInfo ? (
            <AppVersionBanner versionInfo={appVersionInfo} />
          ) : null}
        </div>

        {/* Main content area */}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </main>
  );
}

export default Layout;
