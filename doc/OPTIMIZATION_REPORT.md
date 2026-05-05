# 芝麻灵码 GUI 安装器 — 全面优化评估

## Context

`D:\own\zm_tool\ai_install` 是一个面向中国开发者的 Tauri 2 桌面安装器（Rust + React 19 + TypeScript + Tailwind 4），用于一键安装 Git / Node.js / Nushell 与 Claude / Codex / Gemini / OpenCode CLI，并把 API Key 写入系统环境变量后在终端启动这些工具。当前版本 0.1.0，单窗口固定 900×700，全中文 UI，已有登录/2FA/Turnstile/渠道切换/升级阻塞进程处理等较完整的功能，但存在以下系统性短板：

- **安全性**：前端硬编码 admin/123456 凭据并附带 `local-admin-session` 后门、access+refresh token 以明文存于 `localStorage`、CSP 的 `connect-src` 实质开放任意 `http:`/`https:` 出站、Rust 端 `backend_request` 代理对 URL 仅做协议校验无域名白名单。
- **正确性**：Summary 的"完成"按钮调用 `window.location.reload()` 会丢内存态触发重登。
- **体验/便捷**：渠道切换控件埋在 12px 次要条里、危险启动模式仅用 `window.confirm`、模态遮罩深浅不一致且无 ESC/焦点陷阱、安装日志 10px 不可读、Dashboard 卡片是整体 `<button>` 难以分离主/次操作、ChannelDialog 4 工具纵向滚动表单。
- **美观/可维护**：所有组件用 `inline style + theme.ts 常量`，不能运行时切主题；无暗色模式；遗留组件 `ConfigPanel.tsx` / `KeySelection.tsx` 已不再被引用但未删除。

本评估按 **P0（必做）/ P1（强烈推荐）/ P2（锦上添花）** 三档给出可执行优化清单，每项均含文件:行号 + 改动描述 + 动机。本次仅交付评估文档，不动代码。

---

## 一、问题矩阵概览

| # | 类别 | 问题 | 严重度 | 估时 |
|---|---|---|---|---|
| 1 | 安全·凭据 | `AuthPanel.tsx:36-37` 硬编码 admin/123456 | 高 | S |
| 2 | 安全·凭据 | `backendApi.ts` 中 `local-admin-session` 后门（多处分支） | 高 | S |
| 3 | 安全·存储 | `storage.ts` 把 access+refresh token 明文写 localStorage | 高 | M |
| 4 | 安全·网络 | `tauri.conf.json:23` CSP `connect-src http: https:` 无白名单 | 高 | M |
| 5 | 安全·网络 | `backend.rs` 代理仅校验协议，无 host 白名单，可 SSRF | 高 | M |
| 6 | 安全·UX | `Dashboard.tsx:225` 危险模式仅 `window.confirm` | 高 | S |
| 7 | 正确性 | `Summary.tsx:167` 完成按钮 `window.location.reload()` | 高 | S |
| 8 | 凭据可视 | AuthPanel 无密码可见切换、无"记住登录"开关 | 中 | S |
| 9 | 凭据可视 | API Key 写入 `setx` 系统环境变量但 UI 无任何提示 | 中 | S |
| 10 | 布局 | 窗口固定 900×700 不可缩放；模态尺寸约束不一致 | 中 | S |
| 11 | 布局/便捷 | Dashboard 渠道切换器埋在底部 12px 条；不能删除自定义渠道 | 中 | M |
| 12 | 体验 | 无安装预检（磁盘空间、占用 CLI 进程） | 中 | M |
| 13 | 体验 | Summary 失败项无"重试"按钮；"刷新环境/余额"分散两处 | 中 | S |
| 14 | 体验 | LaunchDialog 不能复制命令；无 Enter/ESC 键盘支持；模态无焦点陷阱 | 中 | S |
| 15 | 交互 | Dashboard 卡片是整体 `<button>`，主/次操作难分离；卡片"Key:" 行不可交互 | 中 | M |
| 16 | 交互 | ChannelDialog 4 工具纵向滚动表单不易导航 | 中 | M |
| 17 | 交互 | ToolList 安装日志 10px 等宽几乎不可读 | 中 | S |
| 18 | 视觉 | 状态条 4 列 × 12px 主指标视觉权重不足 | 低 | S |
| 19 | 视觉 | 模态遮罩 `bg-black/20` vs `0.45` 不一致；AuthPanel Tab 偏右上 | 低 | S |
| 20 | 视觉/可维护 | inline style + theme 常量混杂，无 CSS 变量，不能运行时切换主题 | 中 | L |
| 21 | 视觉 | 无暗色模式 | 中 | L |
| 22 | 视觉 | 检测期 5–10 秒只有 spinner，无骨架/产品标识 | 低 | S |
| 23 | 体验 | AppVersionBanner "可用" 徽标不可点击 | 低 | S |
| 24 | 体验 | 无 API Key 时 Dashboard 仅显示"无匹配 Key"，无 CTA | 低 | S |
| 25 | 可维护 | `ConfigPanel.tsx`、`KeySelection.tsx` 已不被 `App.tsx` 引用但仍在仓库 | 低 | S |
| 26 | 体验 | 散落的小功能（删除渠道、env var、版本横幅）缺少集中入口 | 中 | L |

---

## 二、优化建议（按优先级）

### P0 — 必做：安全 / 正确性

#### P0-1. 删除前端硬编码凭据 + 移除 `local-admin-session` 后门
- 位置：`gui-installer/src/components/AuthPanel.tsx:36-37`
  - 改：`useState("admin")` / `useState("123456")` → `useState("")` / `useState("")`，input 增加 `placeholder="登录邮箱"` / `placeholder="至少 6 位密码"`、邮箱字段 `type="email"`。
- 位置：`gui-installer/src/lib/backendApi.ts`（约 13–15 行常量定义、`login()`、`listApiKeys()`、`getUserProfile()`、`getPaymentCheckoutInfo()` 中所有 `LOCAL_ADMIN_USERNAME` / `LOCAL_ADMIN_PASSWORD` / `LOCAL_ADMIN_TOKEN` / `localAdminSession()` / `isLocalAdminSession()` 引用全部清除。
- WHY：admin/123456 编入 `dist` 后任何反编译都能看到；后门让后端不可达时仍能"登录"得到空账户，掩盖真实失败原因，并诱导用户养成弱口令习惯。

#### P0-2. 凭据从 localStorage 迁移到 OS 加密存储
- 位置：`gui-installer/src/lib/storage.ts:3, 10-21`、Rust 侧新增 `gui-installer/src-tauri/src/secure_store.rs`。
  - 推荐：引入 `tauri-plugin-stronghold`（首选）或自实现基于 Windows DPAPI（`CryptProtectData`）/ macOS Keychain 的 Tauri 命令 `secure_session_get/set/clear`。
  - `loadSession()` / `saveSession()` / `clearSession()` 改为 `await invoke("secure_session_*")`；`App.tsx:47` 同步初始化改为 `useEffect` 异步加载（加 loading 守卫避免一闪 auth）。
  - 最小退路：如不引入新依赖，至少把 `refresh_token` 拆出来仅放 `sessionStorage`（关闭即丢），`access_token` 保留 localStorage 但严格执行 `expires_at` 过期清理。
- WHY：localStorage 对任何注入 JS（含未来引入的第三方脚本）可读；桌面应用应至少落盘加密。

#### P0-3. 收紧 CSP `connect-src`
- 位置：`gui-installer/src-tauri/tauri.conf.json:23`
  - 改：`connect-src 'self' ipc: http://ipc.localhost ${BACKEND_ORIGIN} https://challenges.cloudflare.com https://registry.npmmirror.com`，其中 `${BACKEND_ORIGIN}` 在 `src-tauri/build.rs` 中根据构建期 env `BACKEND_API_BASE_URL` 计算并写回 `tauri.conf.json`（或用 Tauri 的 `csp` 模板）。
  - 开发模式（`tauri dev`）可保留 `http: https:` 通配，由 cargo feature `dev-csp` 控制。
  - 同步更新 `frame-src` 仅保留 Turnstile。
- WHY：当前 CSP 等同没有出站限制，被注入脚本可携 `Authorization` 任意外发。

#### P0-4. Rust 后端代理增加域名白名单与敏感头剥离
- 位置：`gui-installer/src-tauri/src/backend.rs:48-54`（`validate_url`）+ `parse_headers`。
  - 改：用 `url::Url` 解析后校验 `host_str()` 是否在白名单（与 P0-3 同源，构建期注入 `env!("BACKEND_HOST")` + 静态常量 `["challenges.cloudflare.com", "registry.npmmirror.com"]`）。
  - 在 `parse_headers` 黑名单 `Cookie` / `Set-Cookie` / `Host`，避免渲染层注入会话 Cookie 或伪造 Host 头。
  - 不在白名单时返回 `Err("URL not allowed: <host>")` 并日志记录。
- WHY：renderer 任意构造 `backend_request({url, headers})` 可携 `Authorization` 命中任意 host，是典型 SSRF / 凭据外发通道。

#### P0-5. "最高权限" 启动改为品牌化危险确认模态
- 位置：`gui-installer/src/components/Dashboard.tsx:223-227`（`onLaunch` 调用前）。
  - 抽出 `<DangerConfirmDialog tool={selectedTool} onConfirm={...} onCancel={...}>` 子组件，复用 `BlockingProcessesModal` 的视觉风格：红色边框 + 警告图标 + 黑色 0.45 遮罩。
  - 文案需明确写出工具实际危险标志的后果：
    - Codex `--dangerously-bypass-approvals-and-sandbox` → "绕过沙箱与审批，CLI 可任意读写文件、执行命令"
    - Claude `--dangerously-skip-permissions` → "跳过工具调用前的权限确认"
    - Gemini `--yolo` → "自动接受所有写文件/执行操作"
    - OpenCode `OPENCODE_PERMISSION=allow` → "授予全部权限，无任何拦截"
  - 必须勾选"我已了解风险"才能解锁红色"继续启动"按钮；ESC 关闭。
- WHY：`window.confirm` 在 Tauri 上是系统对话框，破窗口品牌且文案"可能修改本机文件"严重低估了实际权限范围。

#### P0-6. Summary 完成按钮改为软重置
- 位置：`gui-installer/src/components/Summary.tsx:33` 加 prop `onDone: () => void`，行 167 `onClick={() => window.location.reload()}` → `onClick={onDone}`；`gui-installer/src/App.tsx:255-257` 传入 `onDone={() => { installer.goDashboard?.() ?? installer.startDetect(); }}`。
- WHY：整页 reload 丢失 `session` / `apiKeys` / `profile` / `channels` 内存态，触发完整重登（stronghold 异步加载尤甚），UX 极差。

---

### P1 — 强烈推荐：体验大幅改善

#### P1-1. 窗口可缩放 + 模态尺寸约束统一
- 位置：`gui-installer/src-tauri/tauri.conf.json:13-20`
  - `"resizable": true`，新增 `"minWidth": 880`、`"minHeight": 640`；可选 `"maximizable": false` 保持桌面工具体验。
- 位置：`gui-installer/src/components/Layout.tsx:18-23`
  - 删除 `height: 700, width: 900` 内联，改为 `className="flex h-full w-full max-w-[1100px] mx-auto p-6"`。
- 位置：`gui-installer/src/components/Dashboard.tsx:273, 329`（LaunchDialog / ChannelDialog 外层）。
  - `bg-black/20` → `bg-black/45` 与 `BlockingProcessesModal.tsx:20` 一致；
  - 内容容器统一加 `max-w-[90vw] max-h-[85vh] overflow-y-auto`。

#### P1-2. 渠道切换提升为顶部主控件 + 渠道删除
- 位置：`gui-installer/src/components/Dashboard.tsx:99-160` 重排。
  - 删除 105 行重复的"当前渠道：xxx"文本；
  - 把 128–148 行 `<select>` 提到 header 右侧主操作区，做成带"渠道"标签的下拉 + 三个图标按钮（编辑 / 新建 / 删除，仅自定义渠道显示）；
  - "刷新环境" + "刷新余额"合并为一个"刷新"按钮，同时调 `installer.startDetect()` 与 `refreshBalance()`。
- 位置：`gui-installer/src/App.tsx`：新增 `handleDeleteChannel(id)`，对应在 Dashboard 加 `onDeleteChannel` prop；删除前若当前在该渠道则切回 `default`，删除前显示二次确认。

#### P1-3. 安装预检（磁盘 + 阻塞进程提前提醒）
- 位置：新增 Tauri 命令 `precheck_install(tools: Vec<String>) -> PrecheckResult` 在 `gui-installer/src-tauri/src/commands.rs`，返回 `{ disk_free_mb, blocking_processes: Vec<RunningProc> }`（复用 `list_blocking_processes` 已有逻辑）。
- 前端：`gui-installer/src/hooks/useInstaller.ts` 在 `openInstall` 触发安装前先调 `precheck_install` 显示 `<PreflightDialog>`：Node ≈ 80 MB / Git ≈ 250 MB / Nushell ≈ 30 MB / 各 CLI ≈ 50 MB 估算 + 关闭 IDE 提示 + 阻塞进程列表。
- WHY：当前 `BlockingProcessesModal` 是 npm hang 后救火，预检能避免大多数发生。

#### P1-4. Summary 失败项一键重试 + 显示总耗时
- 位置：`gui-installer/src/components/Summary.tsx:33-50, 71-87`
  - 顶部统计条右侧加 `{failedCount > 0 && <button onClick={() => onRetry(failedNames)}>重试 {failedCount} 项</button>}`；
  - prop `onRetry` 由 `App.tsx` 调 `installer.retryFailed`（在 `useInstaller` 暴露，复用 `install_tools(failedNames)`）。
  - 顶部新增"总耗时 X.Y 秒"。

#### P1-5. AuthPanel 体验
- 位置：`gui-installer/src/components/AuthPanel.tsx:355-378`（`Input` 组件）
  - password 字段右侧加眼睛切换按钮（`<button type="button" onClick={() => setVisible(v=>!v)}>`），切 `type="text"/"password"`；
  - 100–171 行 `<section>+<div>` 改为 `<form onSubmit={(e)=>{ e.preventDefault(); submit(); }}>`，让 Enter 触发提交（含 2FA）。
- 位置：`AuthPanel.tsx:114-119`：登录/注册 Tab 移到表单上方居中（与标题分开列），与第二屏视觉一致。
- 新增"记住登录"复选框：勾选 → P0-2 中 stronghold 持久化；不勾 → 仅 sessionStorage。

#### P1-6. LaunchDialog 复制命令
- 位置：`gui-installer/src/components/Dashboard.tsx:406-419`（`LaunchButton`）
  - `command` 行右侧加复制按钮：`navigator.clipboard.writeText(command)` + 1.5s "已复制" toast；
  - 阻止冒泡到外层启动按钮。

#### P1-7. 模态键盘统一
- 新增 hook `gui-installer/src/hooks/useDialogKeyboard.ts(open, onClose)`：统一 ESC 关闭 + focus trap + 背景 `inert`。
- 应用：`Dashboard.tsx` 中 LaunchDialog（217–234）、ChannelDialog（236–245）、`BlockingProcessesModal.tsx:17-23`。

#### P1-8. Dashboard 卡片交互重做（确认范围内）
- 位置：`gui-installer/src/components/Dashboard.tsx:177-214`
  - 外层从 `<button>` 改为 `<div role="article">`，避免整卡是大按钮；
  - **已安装**态：右下角显式"打开终端"主操作按钮（点击进入 LaunchDialog）；右上角小齿轮链接"配置 Key"；卡片中部 `Key：` 行直接做成 `<select>` 让用户在卡片上换 Key（`onSelectToolKey` 已在 props）。
  - **未安装**态：整卡半透明灰底 + 中央"安装"按钮（仍调 `onInstall(tool.detectName)`）。
  - **可升级**态：右上角橙色"升级"按钮直接触发 `onInstall`，避免点错卡片。
- 卡片高度 `min-h-[150px]` → `min-h-[180px]`，给版本两行 + Key 行 + 操作按钮足够空间。

#### P1-9. ChannelDialog 改为 Tab 形式（确认范围内）
- 位置：`gui-installer/src/components/Dashboard.tsx:317-367`（ChannelDialog）
  - 引入 `useState<"claude"|"codex"|"gemini"|"opencode">("claude")` + 顶部 4 段式 Tab；
  - 单屏只渲染当前 Tab 工具的两个字段（Base URL + API Key），整体高度从 `max-h-[430px]` 改为内容自适应，去掉 `overflow-y-auto pr-1`；
  - 底部增加"复制其他 Tab 的 Base URL"快捷链接，照顾大多数渠道四工具 BaseUrl 相同的场景。

#### P1-10. ToolList 安装日志重做
- 位置：`gui-installer/src/components/ToolList.tsx:138-149`
  - 删除 `max-h-32 text-[10px]`；
  - 在每个正在安装的卡片右上角增加"详情 ▾"折叠箭头；
  - 新增一个共享底部抽屉 `<InstallLogsPane>`：`max-h-64 text-xs font-mono`，多工具日志按时间合并，自动滚到底部（`useEffect` + `ref.scrollTop = scrollHeight`）。

#### P1-11. AppVersionBanner 可点击
- 位置：`gui-installer/src/components/AppVersionBanner.tsx:11-28`
  - 外层 `<div>` 改 `<button>`，`onClick` 调 `invoke("open_external_url", { url: versionInfo.release_url })`；
  - Rust 侧 `version.rs` 检查更新接口返回结构增加 `release_url: Option<String>`。

---

### P2 — 锦上添花

#### P2-1. CSS 变量化 + 暗色模式（确认范围内）
- 位置：`gui-installer/src/styles/theme.ts` 整体改造为只导出 token name 枚举/类型（仅给 TS 类型补全），实际颜色搬到 `gui-installer/src/styles/index.css`：
  ```css
  :root {
    --bg-primary: #F7F5F0; --bg-secondary: #FFFFFF;
    --accent: #C4704B; --accent-hover: #B5613C;
    --text-primary: #1A1A1A; --text-secondary: #5F6368;
    /* ... */
  }
  [data-theme="dark"] {
    --bg-primary: #1A1A1A; --bg-secondary: #242424;
    --accent: #D8835C; --text-primary: #F2EFE8;
    /* ... */
  }
  ```
- `gui-installer/tailwind.config.js`（如不存在则在 `vite.config.ts` Tailwind 插件中）：把 `colors.accent` 等指向 `var(--accent)`，让 Tailwind class 与 CSS 变量打通。
- 渐进迁移：所有 `style={{ background: theme.xxx }}` → `className="bg-[--bg-primary]"` 或新建工具类 `.bg-primary`。
- 在 Layout 顶栏加暗/亮切换开关，写入 P0-2 的安全存储。

#### P2-2. Settings 抽屉面板（确认范围内）
- 新增 `gui-installer/src/components/SettingsDrawer.tsx`，由 Dashboard header 的齿轮按钮触发，从右侧滑入。集中以下能力：
  1. **渠道管理**：完整 CRUD（含删除，与 P1-2 互补——抽屉内提供更详细的列表视图）；
  2. **环境变量**：列出当前 setx 写入的 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `OPENAI_BASE_URL` 等，提供"清除该变量"按钮（调 `setx VAR ""`）；
  3. **日志目录**：显示路径 `%LOCALAPPDATA%\gui-installer\logs\`，提供"打开目录"按钮（`open_external_url` 或新增 `open_path` 命令）；
  4. **偏好**：暗色模式开关、记住登录开关、检测间隔；
  5. **关于**：版本号、释出说明链接。
- WHY：当前删除自定义渠道、env var 清理、日志查看等能力散落在多处或缺失，集中后可显著降低用户认知成本。

#### P2-3. 环境变量写入透明化提示
- 位置：`gui-installer/src/components/Dashboard.tsx`（LaunchDialog 末尾）和首次保存渠道时。
  - 在 LaunchDialog 末尾加小字："本次启动会通过 `setx` 写入用户级系统环境变量 `ANTHROPIC_API_KEY` 等，可在 Settings → 环境变量中查看与清除"。
- WHY：设备环境被悄悄修改是隐私/合规问题，用户应被明确告知。

#### P2-4. 检测期骨架屏 + 产品标识
- 位置：`gui-installer/src/App.tsx:197-209`
  - 替换 spinner-only：`<DetectSkeleton tools={["Git","Node.js","Nushell","Codex","Claude","Gemini","OpenCode"]} />`，列出名称 + 灰色脉动条（复用 `gentle-pulse` 动画）。
- 位置：`gui-installer/src/components/Layout.tsx:25-27`
  - 顶栏左侧加 `<img src="/assets/logo.svg" /> <span>芝麻灵码</span>`；
  - `tauri.conf.json:15` `"title"` 改 `"芝麻灵码 — AI 环境工作台"`。

#### P2-5. 状态条放大
- 位置：`gui-installer/src/components/Dashboard.tsx:121-126`
  - 4 列状态条 `text-xs` 改为：标签 `text-[11px] text-muted`，主值 `text-base font-semibold`；
  - padding `px-3 py-2` → `px-4 py-3`；让"必要环境 / 可用工具 / 可升级 / 余额"作为主指标足够醒目。

#### P2-6. 空 Key 状态 CTA
- 位置：`gui-installer/src/components/Dashboard.tsx:202-211`
  - 默认渠道下 `selectedKey` 为空时把 `"无匹配 Key"` 替换为可点击的 `<button onClick={openRecharge / openKeyManager}>前往后台创建 Key →</button>`，跳转到 `${PUBLIC_BASE_URL}/keys`。

#### P2-7. 删除遗留组件
- 位置：删除 `gui-installer/src/components/ConfigPanel.tsx`、`ConfigPanel.test.tsx`、`KeySelection.tsx`。
  - 已确认 `App.tsx` 不再 import；先 `grep -r ConfigPanel src` 与 `grep -r KeySelection src` 验证仅测试自身引用，再删；
  - 同步删除 `types.ts` 中只服务于这两个组件的类型（如有）。

#### P2-8. 轻量 i18n 提取（不强求）
- 把所有面向用户的中文字符串集中到 `gui-installer/src/lib/strings.ts`，组件内引用 `t("auth.login")`，无需引入 react-i18next。
- 收益：方便文案 review、发现"选择 vs 选中""渠道 vs 通道"等不一致；为未来多语言留路。

---

## 三、关键文件清单（按预计改动密度排序）

- `gui-installer/src/components/Dashboard.tsx` — P0-5、P1-2、P1-6、P1-8、P1-9、P2-3、P2-5、P2-6
- `gui-installer/src/components/AuthPanel.tsx` — P0-1、P1-5
- `gui-installer/src/lib/backendApi.ts` — P0-1
- `gui-installer/src/lib/storage.ts` — P0-2
- `gui-installer/src-tauri/src/backend.rs` — P0-4
- `gui-installer/src-tauri/tauri.conf.json` — P0-3、P1-1
- `gui-installer/src/styles/theme.ts` + `styles/index.css` — P2-1
- `gui-installer/src/components/Layout.tsx` — P1-1、P2-4
- `gui-installer/src/components/Summary.tsx` — P0-6、P1-4
- `gui-installer/src/components/ToolList.tsx` — P1-10
- `gui-installer/src/components/AppVersionBanner.tsx` — P1-11
- `gui-installer/src/components/BlockingProcessesModal.tsx` — P1-7
- `gui-installer/src/hooks/useInstaller.ts` — P1-3、P1-4
- `gui-installer/src/components/SettingsDrawer.tsx`（新增）— P2-2
- `gui-installer/src-tauri/src/commands.rs` — P1-3、P2-2 中 `open_path`
- `gui-installer/src-tauri/src/secure_store.rs`（新增）— P0-2

---

## 四、验证清单

实施 P0 后需逐项端到端验证：

| 修复 | 验证步骤 |
|---|---|
| **P0-1 凭据** | (a) `npm run build` 后用 7-zip 打开生成的 MSI 解压 `dist/assets/*.js`，全文搜 `123456` / `local-admin-session` 应 0 命中；(b) 启动 UI 邮箱密码框为空 placeholder；(c) 输入 `admin / 123456` 应触发后端 401 而不是进入工作台。 |
| **P0-2 安全存储** | (a) 登录后 DevTools `localStorage` 不再含 `zm_tools_auth_session`；(b) 关闭应用、删除 stronghold 文件后重启应回到 auth；(c) `Get-Content $env:APPDATA\com.ai-tools.installer\session.bin`（或同等路径）应为非可读字节流；(d) 重启后会话仍可恢复。 |
| **P0-3 CSP** | (a) DevTools Console 执行 `fetch("https://example.com/x")` 应被 CSP 拦截并打印 `Refused to connect`；(b) 配置过的后端域 + Turnstile + npmmirror 三域均应正常通过；(c) 开发模式 `tauri dev` 不影响热重载。 |
| **P0-4 后端代理白名单** | (a) DevTools Console `await __TAURI__.invoke("backend_request", { input:{ method:"GET", url:"https://example.com" }})` 应返回 `Err("URL not allowed: example.com")`；(b) 配置的后端域正常 200/401；(c) 请求传入 `Cookie` 头，Wireshark 抓包确认已剥离。 |
| **P0-5 危险确认模态** | (a) Codex 卡点"最高权限"弹出红色边框模态、列出实际危险标志、勾选前继续按钮 disabled；(b) 不勾选关闭再进，状态应重置；(c) 启动后 `tasklist /v` 验证子进程命令行包含 `--dangerously-bypass-approvals-and-sandbox`；(d) ESC 可关闭。 |
| **P0-6 Summary 软重置** | (a) 装完 → 完成 → 停留在 dashboard 且 `apiKeys` / `profile` 立即就绪（无 auth 闪屏）；(b) DevTools Performance 不应看到整页 navigation；(c) Network 面板应仅看到 `detect_tools` + `listApiKeys` + `getUserProfile`，不应有所有 JS chunk 重新加载。 |

P1/P2 实施后建议增加：

- 启动 UI 全键盘走查：Tab 顺序、Enter 提交、ESC 关闭、登录/启动/取消三个核心路径。
- 1280×720 / 1920×1080 / 2560×1440 三档分辨率截图对比，验证可缩放窗口与模态尺寸约束。
- 暗色模式下扫一遍所有屏（auth / dashboard / toollist / installing / summary / blocking / launch / channel / settings），确认对比度 WCAG AA。
- 离线场景：拔网线进入 dashboard，验证渠道下拉、刷新按钮、错误横幅文案是否友好，以及不会卡在白屏。

---

## 五、整体重构方向（已纳入 P1/P2 范围）

- **主题 token → CSS 变量（P2-1）**：当前 `theme.ts` 是 TS 常量对象，所有组件都通过 `style={{}}` 引用，导致无法运行时切换主题，Tailwind 的 `dark:` 修饰符也用不上。改造完成后既能支撑暗色模式，又能让 Tailwind class 体系完整可用，是本次最大的可维护性投资。
- **Settings 抽屉（P2-2）** 把目前散落的小功能（删除自定义渠道、env var 清理、日志目录、版本横幅、记住登录、暗色模式）收拢到一处，显著降低认知成本与未来增加偏好项的成本。
- **Dashboard 卡片交互重做（P1-8） + ChannelDialog Tab 化（P1-9）**：这两项配合后，主屏的"启动 / 配置 Key / 安装 / 升级"四种动作各有清晰的视觉权重，而渠道编辑也从纵向滚动变成单屏单工具，便捷性和美观性同步提升。
- **删除遗留 ConfigPanel / KeySelection（P2-7）**：`App.tsx` 已不再 import，纯属仓库噪音，顺手清理。
- **i18n 提取（P2-8）**：考虑到目标用户是中文开发者不必优先国际化，但集中字符串能在文案 review 时立刻发现一致性问题。

---

## 六、不在本评估范围

- 后端服务（auth API / 充值 / Key 管理）的安全性 — 仅前端可见的范围被覆盖。
- macOS 平台细节（PKG 签名、Notarization）— Windows 是当前主目标。
- npm 包供应链（`@anthropic-ai/claude-code` 等本身的安全性）— 相信上游 + npmmirror。
- 自动更新通道签名验证 — 当前无自更新功能，待引入时单独评估。
