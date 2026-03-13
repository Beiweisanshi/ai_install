# 项目架构: AI 工具链自动部署器

## 概述
一键部署 AI CLI 工具链（Claude/Codex/Gemini）的跨平台脚本工具。

## 技术栈
- Windows: PowerShell 5.1+ / Batch
- macOS: Bash
- 跨平台 TUI: Nushell 0.101+

## 目录结构
```
ai_部署/
├── deploy.bat          # Windows 双击入口（管理员提权 + 调用 ps1）
├── deploy.ps1          # Windows 核心逻辑（~600行）
├── deploy.sh           # macOS 核心逻辑（~320行）
├── deploy-nu.bat       # Nushell TUI 安装器 Windows 入口（静默安装 Nushell + 启动 deploy.nu）
├── deploy-nu.sh        # Nushell TUI 安装器 macOS 入口（静默安装 Nushell + 启动 deploy.nu）
├── deploy.nu           # Nushell TUI 安装器主入口（统一 7 工具 UI 编排）
├── nu/                 # Nushell 模块目录
│   ├── ui.nu           # UI 层：主题（Claude 深色风格）、banner、进度条、表格
│   ├── tools.nu        # 工具定义、检测、版本解析、npm 安装
│   ├── install_win.nu  # Windows 安装逻辑（Git/Node/CC-Switch 本地包 + PATH 刷新）
│   ├── install_mac.nu  # macOS 安装逻辑（Homebrew + .pkg/.tar.gz + brew 回退）
│   ├── upgrade.nu      # 升级逻辑（语义版本比较 + 批量升级）
│   └── config.nu       # 配置引导（CC-Switch/Codex/Gemini 各 URL+Key）
├── README.md           # 使用说明
├── doc/
│   └── schema.md       # 本文件
├── packages/
│   ├── windows/        # Windows 本地安装包（Nushell .msi, Git .exe, Node .msi, CC-Switch .msi）
│   └── macos/          # macOS 本地安装包（Nushell .tar.gz, Node .pkg, CC-Switch .tar.gz）
├── gui-installer/      # GUI 安装器（Tauri 2.x + React + TypeScript）
│   ├── src-tauri/      # Rust 后端（安装逻辑、IPC 命令、配置写入）
│   │   └── src/
│   │       ├── installer/  # 平台安装器（windows.rs, macos.rs, npm.rs, detect.rs）
│   │       ├── types.rs    # 共享类型 + 错误处理
│   │       ├── commands.rs # Tauri IPC 命令
│   │       └── config.rs   # API 配置写入
│   └── src/            # React 前端（Claude 深色主题 UI）
│       ├── components/ # ToolCard, ToolList, ConfigPanel, Summary, Layout
│       ├── hooks/      # useInstaller 状态机
│       └── styles/     # theme.ts + Tailwind 配置
└── .claude/
    └── plan/           # 开发计划文档
```

## 核心模块
1. **deploy.bat**: 启动器，管理员提权 + ExecutionPolicy Bypass
2. **deploy.ps1**: Windows 部署逻辑，本地包 + npmmirror 回退
3. **deploy.sh**: macOS 部署逻辑，Homebrew(清华镜像) + npmmirror
4. **deploy-nu.bat / deploy-nu.sh**: Nushell TUI Bootstrap 入口，静默安装 Nushell 后自动启动 deploy.nu
5. **deploy.nu + nu/**: Nushell TUI 安装器，统一 UI 界面展示全部 7 个工具的安装/升级/配置流程
6. **gui-installer/**: GUI 安装器（第 4 个独立入口），Tauri 2.x Rust 后端 + React 前端，Claude 深色主题 Web UI，便携式分发（Windows .zip / macOS .dmg），共享 packages/ 目录，按需子进程提权

## 安装顺序

### 传统脚本（deploy.ps1 / deploy.sh）
Git → Node.js → npm 镜像 → Claude CLI → Codex CLI → Gemini CLI → CC-Switch

### Nushell TUI 安装器（deploy-nu.bat/sh → deploy.nu）
Nushell（Bootstrap 静默安装） → Git → Node.js → npm 镜像 → Claude CLI → Codex CLI → Gemini CLI → CC-Switch

### GUI 安装器（gui-installer/）
Nushell → Git → Node.js → Claude CLI → Codex CLI → Gemini CLI → CC-Switch（7 个工具，Rust 原生安装逻辑）

## 关键约束
- npm 镜像通过 `--registry` 参数传递，不修改全局配置
- 所有工具安装错误隔离，单个失败不影响后续
- 幂等设计，已安装工具检测版本后决定跳过或更新
- Nushell TUI 不修改现有 deploy.bat / deploy.ps1 / deploy.sh
- Nushell 最低版本 0.101+（`input list --multi` 依赖）
- GUI 安装器不修改任何现有脚本（第 4 个独立入口，与现有 3 套脚本完全解耦）
- 仅支持 Windows + macOS（不含 Linux）
