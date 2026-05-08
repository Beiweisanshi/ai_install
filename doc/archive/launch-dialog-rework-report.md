# LaunchDialog 重做：每工具完整模式 + 工作目录选择 — Review Report

**slug**: `launch-dialog-rework` · **level**: M · **stage**: review → pass · **branch**: main · **workflow**: v8.0

## 变更摘要

11 个文件（3 新增 + 8 修改）：

```
A  gui-installer/src/components/Dashboard.test.tsx     (NEW)
A  gui-installer/src/lib/launchModes.ts                (NEW)
A  gui-installer/src/lib/launchModes.test.ts           (NEW)
M  gui-installer/src-tauri/src/terminal.rs             (rewrite mode mapping + validate_cwd)
M  gui-installer/src/App.tsx                           (pass cwd / call pushRecentCwd)
M  gui-installer/src/components/Dashboard.tsx          (LaunchDialog 上下两区 + pendingLaunch)
M  gui-installer/src/hooks/useInstaller.ts             (launchTool 签名同步)
M  gui-installer/src/lib/storage.ts                    (loadRecentCwds/saveRecentCwds/pushRecentCwd)
M  gui-installer/src/lib/storage.test.ts               (extend pushRecentCwd 测试)
M  gui-installer/src/lib/strings.ts                    (新增 16 条 i18n key)
M  gui-installer/src/types.ts                          (LaunchMode → string、瘦身 AiToolDefinition)
```

## Layer 1 — 正确性（codex CLI）

**Score**: 🟡 凑合 · degraded: false

- 模式表 (id/args/envs) 三元组在 TS 与 Rust **完全一致**（reviewer 逐项核对 + codex 自己核对）
- `validate_cwd` 拒绝集合 `{ ", \r, \n, \0 }` 与 plan 要求一致；空串拒绝；与 `validate_env_value` 的 CR/LF/NUL 边界一致
- DangerConfirmDialog 在 codex.dangerous / claude.dangerous 下正确派生 `previewCommand` 与 `dangerDescription`，文案随工具切换
- legacy alias TS/Rust 两侧结果对齐（`(codex,elevated)→codex.dangerous`、`(claude,elevated)→claude.dangerous`、`(gemini,elevated)→gemini.yolo`、`(opencode,elevated)→opencode.allow-all`）
- 实质问题（concern 级，非 blocker）：
  - **UI 状态机叠层**：dangerous 触发后 `selectedTool` 与 `pendingLaunch` 同时非空；两个 `useDialogKeyboard` 的 window keydown 监听器并存，按 Escape 可能同时关闭两层
  - **三元组一致性测试缺失**：两侧测试只各自枚举 id 列表；args/envs 内容靠手工对照
  - **validate_cwd 双引号跨平台不对称**：Unix `unix_script` 已用 `shell_quote`，理论可接受 `"`，但 `validate_cwd` 无条件拒绝。当前 Windows-only 部署可接受

## Layer 2 — 简化（codex CLI）

**Score**: 🟡 凑合 · degraded: false · 6 项 nice-to-have，无致命：

1. TS `legacyAlias` / `defaultModeId` 仅测试引用（plan §1 显式要求导出，本次保留）
2. `commandArgs` / `envLines` 可压成 `commandPreview: string`
3. Rust elevated fallback 用 `args.len()>1` 隐式推断；可改成显式 alias 表
4. LaunchDialog 的 `recentCwds` 可改 lazy state，删 `useEffect`
5. `pendingLaunch.tool` 与 `selectedTool` 重复存储
6. `pushRecentCwd` 的 `existingIndex/head/rest` 三步骤可压成 `[trimmed, ...filter(lower≠key)].slice(0,5)`

## Layer 3 — 数据结构

| 校验项 | 结果 |
|---|---|
| codex 4 模式 (default/read-only/auto/dangerous) — TS vs Rust | ✓ id/args/envs 完全一致 |
| claude 5 模式 (default/acceptEdits/plan/auto/dangerous) — TS vs Rust | ✓ id/args/envs 完全一致 |
| gemini 4 模式 (default/plan/auto-edit/yolo) — TS vs Rust | ✓ id/args/envs 完全一致 |
| opencode 2 模式 (default/allow-all + OPENCODE_PERMISSION) — TS vs Rust | ✓ id/args/envs 完全一致 |
| `validate_cwd` 拒绝 `"`/`\r`/`\n`/`\0` + 空串 | ✓ |
| legacy alias 覆盖 normal/elevated × 4 工具 | ✓（TS 显式 dangerLevel 路径、Rust 形状推断路径，结果对齐）|

## Layer 4a — 静态检查

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | clean (exit 0, zero output) |
| `npm run build`（codex 自验） | ok, 53 modules, 276.57 kB js / 19.96 kB css |
| `npm run lint` | 不存在 lint 脚本（package.json 仅 `dev/build/preview/test/tauri`），跳过 |

## Layer 4b — 测试

### Frontend (vitest)

| 文件 | tests | new |
|---|---|---|
| `src/lib/launchModes.test.ts` | 14 | NEW |
| `src/lib/storage.test.ts` | 5 | +4 (pushRecentCwd) |
| `src/components/Dashboard.test.tsx` | 6 | NEW |
| 其他既有测试套件 | 20 | — |
| **合计** | **45 passed / 0 failed** | |

### Backend (cargo test)

| module | tests |
|---|---|
| `terminal::tests` | 9 (modes_for / resolve_mode × 4 / validate_cwd × 2 / command_lines × 2) |
| 其他既有测试 | 44 |
| **合计** | **53 passed / 0 failed** |

测试覆盖 plan §测试 列出的全部用例（codex 4/claude 5/gemini 4/opencode 2 渲染 + 危险确认门控 + cwd MRU + validate_cwd）。

## Layer 5 — 集成审查

| 项 | 结论 |
|---|---|
| Tauri 命令契约 (Rust `launch_ai_tool(tool, mode, cwd, env_vars)` ↔ JS invoke `{tool, mode, cwd, envVars}`) | ✓ snake_case → camelCase 自动转换正确 |
| `pendingLaunch` 是否捕获 cwd snapshot | ✓ dangerous 路径下 cwd 已存入 pendingLaunch 对象，DangerConfirm 期间用户改 cwdInput 不会污染 |
| `useInstaller.launchTool` 死代码是否仍编译 | ✓ 签名同步成 `(tool, modeId, cwd)`，invoke 参数对得上；全仓 grep 无调用方（plan §7 允许保留）|
| 测试用例覆盖 plan 列出的全部用例 | ✓ codex(launchModes 全 id 列表) + claude(5 按钮 dom 断言) + gemini(yolo 不弹危险 dom 断言) + opencode(2 按钮 dom 断言) + cwd MRU 预选 + cwd 转发 + 危险确认门控 |

## 已知 concerns（10 项，全部非阻塞）

| id | 严重度 | 摘要 |
|---|---|---|
| ui-state-stack | medium | LaunchDialog + DangerConfirmDialog 同时挂载；两个 keydown 监听器并存 |
| tri-tuple-cross-check | medium | TS/Rust args/envs 一致性靠人工 lockstep，无 CI 交叉验证 |
| validate-cwd-quote-cross-platform | low | validate_cwd 无条件拒绝 `"`，validate_env_value 仅 Windows 拒绝 |
| ts-legacy-alias-dead-code | low | legacyAlias/defaultModeId TS 端只被测试引用 |
| launch-modes-fields-redundancy | low | commandArgs/envLines 可压成预览字符串 |
| rust-elevated-shape-inference | low | terminal.rs elevated fallback 用 args.len() 隐式推断 |
| launch-dialog-cwd-state | low | recentCwds 可改 lazy state，删 useEffect |
| push-recent-cwd-casing-complexity | low | existingIndex/head/rest 可压成单行 filter |
| cwd-select-case-mismatch | low | select 高亮用大小写敏感比较，与 pushRecentCwd 不一致 |
| useinstaller-launchtool-deadcode | low | launchTool 全仓无调用方 |

## Acceptance criteria 核对

| 验收项 | 状态 |
|---|---|
| Dashboard LaunchDialog 上下两区布局 | ✓ section workingDirTitle + section launchModeTitle |
| dropdown(recent 5) + 文本输入；为空 cwd=null | ✓ App.tsx 第 281 行 cwd 直接透传，trim() \|\| null |
| 每工具显示自身全部模式按钮 (4/5/4/2) | ✓ Dashboard.test.tsx 已断言 claude 5 + opencode 2，launchModes.test.ts 断言全部 id |
| codex.dangerous / claude.dangerous 触发 DangerConfirmDialog | ✓ Dashboard.tsx 第 274 行 dangerLevel === "dangerous" 走 pendingLaunch |
| 成功启动后 pushRecentCwd（仅 cwd 非空时） | ✓ App.tsx 第 284 行 `if (cwd) pushRecentCwd(cwd)` |
| validate_cwd 拒绝 `" \r \n \0` | ✓ terminal.rs::validate_cwd + 单元测试覆盖全部 4 字符 |
| vitest 全绿 + cargo test 全绿 | ✓ 45/45 + 53/53 |

## 置信度

**high**

依据：模式表两侧逐项核对一致；测试 100% 覆盖 plan 用例；tsc/build/cargo test/vitest 全过；codex 双层审查均确认无致命问题；UI 状态叠层是 UX 瑕疵但不破坏功能或数据。
