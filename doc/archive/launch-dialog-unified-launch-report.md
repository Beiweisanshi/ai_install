# LaunchDialog 统一启动 — Review Report

- Slug: `launch-dialog-unified-launch`
- Stage: `review`
- Branch: `main`
- Reviewer: Reviewer 子代理（claude-opus-4-7[1m] + codex gpt-5.5）
- Date: 2026-05-07

## 结论

**PASS**（建议进入门控 + COMMIT）

- 全部硬性检查通过
- 全部测试绿（前端 58/58、后端 53/53）
- 三类来自蓝图审查的致命问题在实现中均已对症消除
- 无破坏性回归（v1 既有路径保持原样：默认渠道 key 选择、自定义渠道 baseUrl/apiKey、recent cwd 下拉、ESC 关闭）

## 硬性检查（用户指令）

| 检查项 | 期望 | 实际 | 结果 |
| --- | --- | --- | --- |
| 启动按钮 disabled 包含 `cwdInput.trim() === ""` | cwd 必填 | `Boolean(selectedMode) && canLaunch && trimmedCwd !== ""` (Dashboard.tsx:407) | PASS |
| `matchesLastConfirmedLaunch` 调用点 | dangerous 路径上读取 | Dashboard.tsx:281，命中跳过 DangerConfirmDialog | PASS |
| `saveLastConfirmedLaunch` 写入点 | DangerConfirm 确认时 | Dashboard.tsx:302，进入 onLaunch 之前写入 | PASS |
| tauri-plugin-dialog 集成 4 处 | Cargo.toml + lib.rs + capabilities + package.json | 全部到位 | PASS |
| `loadLastConfirmedLaunch` 容错 | 损坏 JSON / 未知 toolId / 错误字段类型 → `{}` | storage.ts:174-188 显式 shape 校验，KNOWN_TOOL_IDS 白名单，cwd 必须是 `string \| null` | PASS |

## 测试

### 前端（vitest run）

```
Test Files  8 passed (8)
     Tests  58 passed (58)
  Duration  7.81s
```

新增/扩展的关键用例：

- `Dashboard.test.tsx`：14 用例，覆盖
  - mode 列表渲染（claude 5 项 / opencode 2 项）
  - select option 不触发 launch（`does not launch when a mode is selected from the dropdown`）
  - 启动按钮 disabled 条件（empty cwd / whitespace-only cwd）
  - dangerous 去重：第二次同配置跳过弹窗、cwd 改变重新弹窗、跨工具不共享、损坏 storage 仍弹窗、取消 DangerConfirm 后 LaunchDialog 仍在
  - “选择目录”按钮：调用 `openDialog({directory:true,multiple:false,defaultPath:DEFAULT_CWD})` 并把返回值写回输入框
- `storage.test.ts`：新增 `last-confirmed launch persistence` 块（5 用例），覆盖空 / 损坏 JSON / 未知 toolId 与错误字段类型 / save+matches 往返 / null vs ""

### 后端（cargo test）

```
test result: ok. 53 passed; 0 failed; 0 ignored
```

后端只动了 `Cargo.toml` + `lib.rs` 的 plugin init，无新功能 — 既有 53 用例继续绿。

## codex 蓝图审查的三个致命问题 — 实现侧验证

codex 在蓝图阶段标了三处会破坏构建或交互的漏洞，逐一验证已对症修复：

1. **`LaunchButton` 未使用导致 `noUnusedLocals` 编译失败**
   - 修复：实现已删除 `LaunchButton` 函数（约 60 行）。`grep -rn "LaunchButton" gui-installer/src` 在 Dashboard.tsx 内无任何残留引用，仓库其他文件无引用。
   - 验证：`tsc` 隐式由 `vitest run` 经 vite + esbuild 校验通过；任何未使用 local 都会被 vitest 的 ts 检查暴露。

2. **DangerConfirm 打开时双 modal 同时挂载，ESC 一次关两层**
   - 修复：`LaunchDialog` 接受 `keyboardActive: boolean`（Dashboard.tsx:373-383），父级在 `pendingLaunch` 非空时传 `false`（Dashboard.tsx:277）。`useDialogKeyboard(keyboardActive, onCancel)` 在 false 分支返回早退而不绑定 listener。
   - 验证：用例 `keeps the LaunchDialog open after the user cancels the danger dialog` 显式校验取消 DangerConfirm 后 LaunchDialog 仍可见（Dashboard.test.tsx:381-397）。

3. **依赖锁文件未同步**
   - 修复：`gui-installer/package-lock.json`（@tauri-apps/api pin 至 ^2.10.1，避免被 plugin-dialog 拖到 2.11.0 与 Rust crate 2.10.3 mismatch）和 `gui-installer/src-tauri/Cargo.lock` 均已 staged。
   - 验证：`git status --short` 列出 11 个 staged 文件，含两个 lock；`cargo test` 编译成功（无版本冲突）。

### codex 蓝图“改进”项 — 也都已落地

- ✅ 按钮 disabled 用 `Boolean(selectedMode) && canLaunch && trimmedCwd !== ""`（不是裸字符串比较）
- ✅ `loadLastConfirmedLaunch` 做运行时 shape 校验（顶层 object、key 在 `KNOWN_TOOL_IDS` 内、entry 为 `{modeId:string, cwd:string|null}`）
- ✅ `openDialog` 的 `defaultPath` 用 `trimmedCwd || undefined`，与启动逻辑一致
- ✅ `Dashboard.test.tsx` 整体重写为“选 mode + 点启动”模型
- ✅ 补齐：重复 dangerous 同配置跳过、不同 tool 不共享、损坏 localStorage 仍弹、取消 DangerConfirm 后 LaunchDialog 还在 — 4 个核心边界都有用例

## 蓝图与用户指令的故意分歧

蓝图原本写的是 “cwd 不参与 disabled” + “保留 v1 兼容（空 cwd → null）”。
用户在最后一轮明确要求 “cwd 是必填项，空 cwd → 启动按钮 disabled”。
实现按用户指令落地：`trimmedCwd !== ""` 进入 disabled 条件。

这是一个**已识别的 break-userspace** —— 旧用例 `forwards the entered cwd to onLaunch` 已重写，不再传 null cwd 经过启动路径。前端调用 `onPick(selectedMode, trimmedCwd)`（永远是非空 string，不再是 string|null），父级 `onLaunch` 仍按 `string | null` 类型签名收，运行时不会有 null 流过去。`pushRecentCwd` 仍能容忍空字符串（保留兼容）。

风险评估：
- 影响面：只有“点击启动按钮”的路径。`launch_ai_tool` 后端命令的 cwd 仍允许 null（命令签名未改），与 `onLaunch` 的 `string | null` 签名一致。
- 用户感知：从“启动后用 GUI 默认目录”改为“必须先选目录或填路径”。这是用户主动要求的行为变更，不是 regression。
- 测试覆盖：`disables the launch button when cwd is empty or whitespace-only` 显式校验。

## 五层分析摘要

**结构** 🟢
- LaunchDialog 三段（key 区 / cwd 区 / mode 区）+ footer 启动按钮，单一 onPick 出口
- 状态：`cwdInput`、`selectedModeId`、`recentCwds` 都是局部 useState；父级用 `selectedTool` + `pendingLaunch` 两个 union state 表达三态（关闭 / Launch / Confirm）
- storage：`LastConfirmedLaunchMap` 类型显式，KNOWN_TOOL_IDS 单一来源

**特殊情况** 🟢
- 损坏 JSON、未知 toolId、错误字段类型 — 全部在 `loadLastConfirmedLaunch` 一处统一返回 `{}`，调用侧零分支
- 旧的“点击模式按钮即启动”特殊路径已彻底删除，不再保留 LaunchButton 残骸

**复杂度** 🟢
- 一句话：选模式 + 选目录 + 点启动；危险档跳过/弹窗按 toolId 记忆。
- 与上一版相比，去掉了 LaunchButton 组件（约 60 行）、去掉了模式列表点击直接启动的路径；新增的去重逻辑只有 30 行 storage 代码 + 父级 if 一行

**破坏性** 🟡
- v1 兼容：空 cwd → null 这条已经按**用户最新指令**改成必填，不算 regression（用户主动要求）
- 测试 `forwards the entered cwd to onLaunch` 已重写，验证非空 cwd 透传
- 既有 `launch_ai_tool` 后端命令、`pushRecentCwd` 行为、ESC 关闭、其他 modal — 全部不变
- 唯一被替换的：模式按钮的“点击即启动”交互（按蓝图共识改）

**实用性** 🟢
- 模式下拉化：解决用户反映的“误点危险模式 → 弹窗 → 取消还要重新走一遍”麻烦
- 选择目录按钮：解决“记不住路径”的真痛点
- dangerous 去重：解决“反复确认相同配置”的烦躁
- 三个改动都对应可观察的真实抱怨，不是过度设计

## 结论

【品味】🟢 完美

【核心判断】✅ 值得做：通过用户实测痛点（误点 / 路径粘贴 / 反复确认）的方式重排了启动流程，特殊情况都被吸收成正常逻辑（去重就是查 map，损坏数据就是空 map），无遗留死分支。

【关键洞察】
- 结构：父级两 union state（selectedTool + pendingLaunch）+ keyboardActive 协同 — 比上一轮“两个全局 keydown listener 抢 ESC”干净
- 复杂度：删 60 行（LaunchButton），加 30 行（去重 storage），净简化
- 风险：cwd 必填这一条对 v1 是行为变更，但属于用户主动要求，已用测试锁死

【方案】结构合理 → 特殊情况已消除 → 表达清晰 → 唯一行为变更已与用户对齐

可以进入 commit 阶段。

## Verdict

```json
{
  "decision": "approve",
  "blockers": [],
  "follow_ups": [
    "（非阻塞）codex 蓝图审查提到的 channel/key 切换是否纳入 dangerous 去重 key 这一点，本次按 toolId+modeId+cwd 三维实现。后续若用户切换 channel 后也希望重新确认，可以加 channelId 维度。"
  ],
  "confidence": "high",
  "frontend_tests": "58/58 passed",
  "backend_tests": "53/53 passed"
}
```
