# 优化 GUI Installer 安装流程

## 问题

GUI installer 安装工具时直接失败，但 deploy.bat (→ deploy.ps1) 能成功。
根因：GUI installer 缺少 deploy.ps1 中的关键容错机制。

## 改动范围

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `gui-installer/src-tauri/src/installer/windows.rs` | 修改 | 添加安装后等待、改进命令检测 |
| `gui-installer/src-tauri/src/installer/npm.rs` | 修改 | npm install 超时保护、cmd.exe 封装 |
| `gui-installer/src-tauri/src/installer/mod.rs` | 修改（可能） | 调整 timeout 常量或管道逻辑 |

## 具体改动

### 1. windows.rs — 安装后等待 MSI/EXE 进程退出

**对标 deploy.ps1**: `Wait-InstallerIdle` 函数

新增 `wait_installer_idle(timeout_secs: u64)` 函数：
- 循环检测 `msiexec.exe`、`setup.exe`、`Git-*.exe`、`node-*.exe` 进程是否存在
- 使用 `tasklist` 命令 + 过滤
- 间隔 3 秒检测，超时后继续（不阻塞）
- 在 `GitInstallerWin::install()` 和 `NodeInstallerWin::install()` 的 `ensure_success()` 后调用

### 2. windows.rs — Node.js 安装后递增延迟重试

**对标 deploy.ps1**: 3 轮重试 (5s/10s/15s) + 每轮刷新 PATH

修改 `NodeInstallerWin::install()`：
- `ensure_success()` 后，调用 `wait_installer_idle(60)`
- 3 轮循环：延迟 5/10/15 秒，每轮 `refresh_path_win()` + `command_version("node")`
- 任一轮成功即返回

### 3. windows.rs — Git 安装后等待

修改 `GitInstallerWin::install()`：
- `ensure_success()` 后，调用 `wait_installer_idle(30)`
- 再 `refresh_path_win()` + 检测版本

### 4. windows.rs — command_version 用 cmd.exe /c where 预检

**对标 deploy.ps1**: `Get-ToolVersion` 先调 `where` 确认命令存在

新增 `command_exists_via_where(program: &str) -> bool`：
- 执行 `cmd.exe /c where {program}`
- 返回是否找到

修改 `command_version()`：
- 先调 `command_exists_via_where()` 快速判断
- 不存在则直接走 fallback 逻辑（不尝试执行）

### 5. npm.rs — npm install 通过 cmd.exe /c 执行 + 真正的超时保护

**对标 deploy.ps1**: `cmd.exe /c "npm install -g ..."` + 进程级超时

修改 `npm_command()`：
- 改为 `cmd.exe /c npm.cmd ...` 形式
- 使用 `std::process::Command` spawn 后手动 `wait_with_output` + timeout
- 或改为 `tokio::process::Command` 使 tokio timeout 生效

修改 `npm_install()`：
- 改为 async 函数
- 使用 spawn + tokio timeout（180s），超时可 kill 子进程
- 安装后 refresh_path

### 6. npm.rs — ensure_node_ready 增加重试

修改 `ensure_node_ready()`：
- 添加 3 次重试，每次间隔 3 秒 + refresh_path
- 避免 Node.js 刚装完 PATH 未更新导致的误判

## 不改动的部分

- ToolInstaller trait 签名不变
- 前端 useInstaller.ts 不变
- IPC 命令签名不变
- packages 目录定位逻辑不变（打包后路径正确）
- Nushell 和 CC-Switch 安装器不变（问题聚焦在 Git/Node/npm 链路）

## 风险评估

- **低风险**：所有改动在现有函数体内，不改接口
- **向后兼容**：等待和重试只会让安装更稳健，不影响已安装场景
- **超时保护**：确保任何情况下不会无限阻塞
