import ConfigPanel from "./components/ConfigPanel";
import Layout from "./components/Layout";
import Summary from "./components/Summary";
import ToolList from "./components/ToolList";
import { useInstaller } from "./hooks/useInstaller";
import { useSmoothedProgress } from "./hooks/useSmoothedProgress";

function App() {
  const installer = useInstaller();
  const smoothedProgress = useSmoothedProgress(installer.progress);

  return (
    <Layout appVersionInfo={installer.appVersionInfo}>
      {installer.phase === "detecting" && (
        <div className="flex h-full items-center justify-center">
          <p style={{ color: "rgba(255,255,255,0.7)" }}>正在检测已安装工具...</p>
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
    </Layout>
  );
}

export default App;
