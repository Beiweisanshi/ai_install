import BlockingProcessesModal from "./components/BlockingProcessesModal";
import ConfigPanel from "./components/ConfigPanel";
import Layout from "./components/Layout";
import Summary from "./components/Summary";
import ToolList from "./components/ToolList";
import { useInstaller } from "./hooks/useInstaller";
import { useSmoothedProgress } from "./hooks/useSmoothedProgress";
import { theme } from "./styles/theme";

function App() {
  const installer = useInstaller();
  const smoothedProgress = useSmoothedProgress(installer.progress);

  return (
    <Layout appVersionInfo={installer.appVersionInfo} phase={installer.phase}>
      {installer.phase === "detecting" && (
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
              style={{ color: theme.accent }}
            />
            <p className="text-sm" style={{ color: theme.textSecondary }}>正在检测已安装工具...</p>
          </div>
        </div>
      )}

      {(installer.phase === "selecting" || installer.phase === "installing") && (
        <ToolList
          tools={installer.tools}
          selected={installer.selected}
          onToggle={installer.toggleTool}
          onSelectAll={installer.selectAll}
          onDeselectAll={installer.deselectAll}
          onStartInstall={installer.startInstall}
          installing={installer.phase === "installing"}
          progress={smoothedProgress}
          logs={installer.logs}
        />
      )}

      {installer.phase === "configuring" && (
        <ConfigPanel
          tools={installer.results.filter((result) => result.success).map((result) => result.name)}
          onSave={installer.saveConfig}
          onSkip={installer.skipConfig}
        />
      )}

      {installer.phase === "summary" && <Summary results={installer.results} tools={installer.tools} />}

      {installer.blocking && (
        <BlockingProcessesModal
          state={installer.blocking}
          onKillAndRetry={installer.killBlockingAndRetry}
          onRetry={installer.retryBlocking}
          onDismiss={installer.dismissBlocking}
        />
      )}
    </Layout>
  );
}

export default App;
