# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ai_install / **芝麻工作台** — 一站式分发器，安装 Git、Node.js、Claude/Codex/Gemini CLI。两条独立分发路径共存：

- **命令行**：`deploy.bat`/`deploy.ps1`/`deploy.sh`/`deploy.nu` → 读 `packages/{windows,macos}/` 本地包安装系统依赖，CLI 工具走 npm（npmmirror 镜像）。Nushell 版（`deploy.nu` + `nu/`）是跨平台 TUI。
- **GUI**：`gui-installer/` — Tauri 2 应用，发布产物 `dist/gui-installer.exe`。

`packages/` 里的本地安装包不入仓库；GUI 与命令行**共用**这个目录的物料。

## GUI 架构（gui-installer/）

- **前端** `src/` — React 19 + Vite 7 + Tailwind v4。所有"业务"调用走两层：
  - 设备本地操作（检测/安装/启动 CLI、写配置）→ `@tauri-apps/api` 的 `invoke()` → Rust commands
  - 用户 / 支付 / 设置等云端数据 → `src/lib/backendApi.ts` → Rust `backend_request` → 转发到 `BACKEND_API_BASE_URL`（默认 `http://localhost:8080/api/v1`）
- **后端** `src-tauri/src/` — Rust + Tauri 2。入口 `lib.rs::run()` 注册 ~20 个 invoke handlers（见 `commands.rs`）。模块分工：
  - `installer/` — `detect.rs` / `windows.rs` / `macos.rs` / `npm.rs`：装机检测与分平台安装逻辑
  - `backend.rs` — HTTP 转发到云端 API；host 白名单由 `BACKEND_HOST`（build.rs 编译期注入）+ 静态列表组成
  - `secure_store.rs` — Windows DPAPI 包装的会话存储
  - `channel_config.rs` / `config.rs` — 写入用户级 CLI 配置文件
  - `terminal.rs` — 启动 AI CLI 的终端窗口（含 `launch_ai_tool` 的 cwd / mode 切换逻辑）

### Autorun / 无头模式

设置 `GUI_INSTALLER_AUTORUN_TOOLS=claude,codex` 启动 GUI，会自动跑一遍"detect → install → detect"，把 JSON 报告写到 `GUI_INSTALLER_AUTORUN_OUTPUT` 路径并按结果设置 exit code。`packages-windows-complete.cmd` 等批处理依赖这个机制做 CI/烟测。

## 常用命令

所有 GUI 命令都在 `gui-installer/` 目录里。

```bash
npm run dev          # 仅前端 vite，不带 Rust（很少单独用）
npm test             # vitest run
npm run tauri dev    # 通用 tauri dev（Windows 不要直接用，见下）
```

**Windows dev**（必须经过 GNU 工具链，否则编译失败）：

```powershell
.\dev-gnu.ps1            # 前台跑 tauri dev
.\dev-gnu-detach.ps1     # 后台跑，日志写到 dev.log / dev.log.err
```

两个脚本都会设 `CARGO_TARGET_DIR=D:\ai_tools_tmp\tauri-target`、`PATH` 注入 `D:\ai_tools_tmp\winlibs\mingw64\bin`、`CARGO_BUILD_TARGET=x86_64-pc-windows-gnu`。

**云端后端**（见下面"集成的外部组件"）：

```bash
cd D:/study/ai_download/web/sub2api_sanhu/deploy
docker compose -f docker-compose.yml up -d   # 用预构建镜像 weishaw/sub2api:latest，自带 postgres + redis
```

不要用 `docker-compose.dev.yml` — 它会本地 build 前端，pnpm v10 的 `ERR_PNPM_IGNORED_BUILDS` 会让 build 失败。

## 集成的外部组件

本仓库不是孤立的 — 它依赖两个**位于仓库外**的兄弟项目，路径在本机固定：

| 组件 | 路径 | 角色 |
|------|------|------|
| **cc-switch** | `D:\study\ai_download\cc-switch\cc-switch\` | Claude API 端点切换工具，作为本工程"被分发的工具"之一，在 `deploy.ps1` / GUI installer 里和 Claude/Codex/Gemini CLI 并列处理 |
| **后端**（sub2api_sanhu） | `D:\study\ai_download\web\sub2api_sanhu\` | GUI 登录 / 用户 / 支付 / 设置页面对接的云端 API（默认 `http://localhost:8080/api/v1`），Go + Postgres + Redis，标准 compose 起 |

修改 GUI 登录/付费/管理后台相关代码时，**先把后端起来**再 dev，否则 `backendApi.ts` 全部请求挂掉，前端会停在登录页。

调整 cc-switch 安装/检测逻辑（`installer/windows.rs`、`installer/detect.rs`、`commands.rs::npm_pkg_for_tool`）前，去 cc-switch 仓库看它当前的发布形态（npm 包名、二进制名）— 这个映射不是 ai_install 自己定义的。

## 构建（关键约束 — 来自 AGENTS.md）

### Windows

```powershell
cd gui-installer
.\build-windows-gnu.ps1
```

**绝不要用 `cargo build` 直接构建 Tauri 应用**。Plain cargo build 会嵌入 `cfg(dev)`，发布出去的 `.exe` 启动后停在 `http://localhost:1420`，表现为"网络连接错误"。Release 必须走 `npx tauri build --no-bundle --target x86_64-pc-windows-gnu`。

### macOS（必须在 Mac 上跑）

```bash
cd gui-installer
npm run build:macos
# 通用包：MACOS_TARGET=universal-apple-darwin npm run build:macos
```

### 仓库路径包含中文

`D:\study\ai_download\ai_install` 路径含 ASCII 字符，但 `D:\work\ai_部署\` 这类历史路径不含。`dlltool.exe` 不能写非 ASCII 路径 → `CARGO_TARGET_DIR` / `TEMP` / `TMP` 必须强制到 `D:\ai_tools_tmp\` 之类的 ASCII 目录（脚本已这么做）。

### Windows 子进程必须隐藏窗口

`installer/windows.rs` 里所有 `Command::spawn` 必须经隐藏窗口的辅助函数（`CREATE_NO_WINDOW` flag），否则 GUI 跑检测/安装时屏幕会闪 cmd 窗口。新增 Windows 子进程调用时，复用现有 helper，不要直接 `Command::new`。

### 构建后清理

构建脚本会落 `dist/*.next.exe` / `dist/_tmp*` 这种文件占用时的回退产物。完成构建后删掉这些过期物。

## 测试

`gui-installer` 用 vitest，配置 `vitest.config.ts` + `src/test-setup.ts`。运行单个测试：

```bash
npx vitest run src/components/SomeComponent.test.tsx
```

Rust 端本仓库无 unit test 套件。

## 仓库行为约定

- `doc/` 是正式文档；`doc/archive/` 是 work skill 流程留下的 plan/report/state 产物，会随特性分支一起 commit，方便回溯，不要清理。
- `gui-installer/dev.log` / `dev.log.err` 是 detach 脚本的运行时日志，**不要**入仓库（已被忽略 / 临时文件）。
- 历史 commit 风格：`feat(gui): ...` / `fix(gui): ...` / `style(gui): ...` / `chore(doc): ...` / `refactor: ...`。提交前看 `git log --oneline -10`。

## 版本横幅元数据

GUI 启动会拉版本对比信息，按以下顺序解析：

1. `GUI_INSTALLER_VERSION_URL`（远端 JSON）
2. `GUI_INSTALLER_VERSION_FILE`（本地路径覆盖）
3. `dist/app-version.json`（仓库内 fallback，shape：`{"latest_version":"0.1.0","download_url":"..."}`）
