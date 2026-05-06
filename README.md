# 芝麻工作台

一键安装 AI 编程工具链（Claude CLI / Codex CLI / Gemini CLI）及其依赖，支持 Windows 和 macOS。

## 功能

- **一键部署** — 自动安装 Git、Node.js、Claude CLI、Codex CLI、Gemini CLI
- **离线 + 在线** — 基础依赖（Git/Node.js）从本地安装包安装，CLI 工具通过 npm 在线安装（npmmirror 镜像加速）
- **幂等安装** — 已安装的自动跳过，需更新的自动更新
- **错误隔离** — 单个工具失败不影响其他工具
- **GUI 安装器** — 提供基于 Tauri 的图形界面安装器（Windows）
- **完整卸载** — 提供一键卸载脚本

## 安装的工具

| 工具 | 说明 |
|------|------|
| [Git](https://git-scm.com/) | 版本控制 |
| [Node.js](https://nodejs.org/) | JavaScript 运行时（LTS） |
| [Claude CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) | Anthropic Claude 命令行工具 |
| [Codex CLI](https://www.npmjs.com/package/@openai/codex) | OpenAI Codex 命令行工具 |
| [Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli) | Google Gemini 命令行工具 |

## 快速开始

### 方式一：GUI 安装器（推荐，仅 Windows）

1. 从 [Releases](../../releases) 下载最新的 `automatic_installation.zip`
2. 解压到任意目录
3. 双击运行 `gui-installer.exe`

> GUI 安装器会自动检测已安装的工具，提供可视化的安装进度。

### 方式二：命令行安装

#### Windows

1. 准备安装包（放到 `packages/windows/` 目录）：
   - [Git](https://git-scm.com/download/win) — 下载 `Git-*-64-bit.exe`
   - [Node.js](https://nodejs.org/) — 下载 `node-*-x64.msi`（LTS 版本）

2. 双击 `deploy.bat` 运行（会自动请求管理员权限）

#### macOS

1.（可选）准备安装包放到 `packages/macos/`，没有会自动通过 Homebrew 安装

2. 运行：
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

#### Nushell（跨平台）

如果你使用 [Nushell](https://www.nushell.sh/)：

```bash
nu deploy.nu
```

## 卸载

### Windows

双击 `uninstall.bat`（会自动请求管理员权限）

### macOS

```bash
chmod +x uninstall.sh
./uninstall.sh
```

## 项目结构

```
ai_install/
├── deploy.bat / deploy.ps1     # Windows 命令行安装
├── deploy.sh                   # macOS 命令行安装
├── deploy.nu                   # Nushell 跨平台安装
├── uninstall.bat / uninstall.ps1  # Windows 卸载
├── uninstall.sh                # macOS 卸载
├── gui-installer/              # Tauri GUI 安装器源码
│   ├── src/                    # React 前端
│   └── src-tauri/              # Rust 后端
├── nu/                         # Nushell 模块
├── dist/                       # 构建产物
└── packages/                   # 本地安装包（不含在仓库中）
    ├── windows/
    └── macos/
```

## 构建 GUI 安装器

参见 [GUI 安装器构建指南](doc/gui-installer-build.md)。

## 常见问题

**Q: 提示找不到安装包？**
A: 确保安装包放在 `packages/windows/` 或 `packages/macos/` 目录下，文件名需匹配对应模式（如 `Git-*-64-bit.exe`、`node-*-x64.msi`）。

**Q: npm 安装很慢？**
A: 脚本已内置 npmmirror 镜像加速，无需额外配置。

**Q: 安装完成后命令找不到？**
A: 关闭并重新打开终端，让 PATH 环境变量生效。

**Q: GUI 安装器打开后白屏？**
A: 确保 `gui-installer.exe` 与 DLL 文件在同一目录，且系统已安装 WebView2 运行时（Windows 10/11 通常已内置）。

## 许可证

[MIT](LICENSE)
