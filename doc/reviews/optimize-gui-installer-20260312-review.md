# Code Review: GUI Installer 优化（第二轮 — 进度条 + 版本显示 + 升级）

**日期**: 2026-03-12
**审查者**: code-reviewer agent
**审查范围**:
- `gui-installer/src-tauri/src/installer/mod.rs` — 后端进度点
- `gui-installer/src/hooks/useSmoothedProgress.ts` — 新文件：平滑进度 hook
- `gui-installer/src/App.tsx` — 集成 smoothed progress
- `gui-installer/src/components/Summary.tsx` — 版本对比 + 升级按钮
- `gui-installer/src/hooks/useInstaller.ts` — 安装后 re-detect
- `gui-installer/src/components/ToolCard.tsx` — 版本文案优化
- `gui-installer/src/components/ToolCard.test.tsx` — 测试
- `gui-installer/src/components/Summary.test.tsx` — 测试

---

## 总评

> **品味**: 🟢 良好偏优

改动目标清晰：解决进度条卡顿、版本文案不清晰、安装后缺少升级入口三个真实问题。方案选择务实 — 后端加两个中间进度点 + 前端平滑插值，而非大改每个 installer 的内部进度上报。Summary 升级功能复用了现有 `install_tools` 命令，没有引入新 API。整体代码质量高，结构清晰。

**评分: 8.5 / 10**

---

## 逐项审查

### 1. `installer/mod.rs` — 后端进度点

**改动**: 在 `install_tool_pipeline` 中添加了两个中间进度事件：
- L72: `installing` 阶段 20%（"Preparing installation"）
- L100-106: `installing` 阶段 70%（"Installation finished, preparing verification"）

**正确性**: 完美。进度序列变为 0 → 10 → 20 → 70 → 80 → 100，覆盖了完整生命周期。20% 在 install 开始前发射，70% 在 install 成功后、verify 前发射。语义清晰。

**向后兼容**: 只是增加了事件，不影响已有的 `install-progress` 监听者。**无破坏**。

**结论**: 通过。零问题。

### 2. `useSmoothedProgress.ts` — 新文件

**设计**: 用 `setInterval(400ms)` 渐进式增加显示进度，上限 `CEILING_DURING_INSTALL = 65`。当真实事件到达时立即跳到真实值。

**正确性 [GOOD]**:
- 第一个 `useEffect`（L28-43）：当真实进度 >= 显示进度时同步，`changed` 标志避免不必要的 re-render。正确。
- 第二个 `useEffect`（L46-83）：定时器逐步推进显示值。清理函数 `clearInterval` 存在。依赖数组为 `[]`，只创建一次。正确。
- `realRef` 用 ref 避免定时器闭包捕获过期值。标准模式，正确。

**问题 [LOW]**: `CEILING_DURING_INSTALL = 65` 而后端 install 完成后发射 70%。这意味着进度条会在 65% 处停顿，然后跳到 70%。5% 的跳跃在视觉上几乎不可察觉，合理。但如果 install 时间很短（< 2秒），进度可能还没爬到 65% 就直接跳到 70%，这也是可接受的行为。

**问题 [LOW]**: 当工具安装失败时（`real.percent >= 100`），定时器跳过该工具，但 `display` 中该工具的值可能停在某个中间状态。不过失败时 UI 会切换到 failed 状态展示，不再显示进度条，所以**无实际影响**。

**性能**: `setInterval(400ms)` 对 N 个工具遍历一次 `Object.entries`，开销可忽略。`clearInterval` 在卸载时正确调用，**无内存泄漏**。

**结论**: 通过。设计简洁有效。

### 3. `App.tsx` — 集成

**改动**: 一行新增 `useSmoothedProgress(installer.progress)`，将结果传给 `ToolList`。

**正确性**: 完美。`smoothedProgress` 的类型 `Record<string, { percent: number; stage: string }>` 与 `ToolList` 的 `progress` prop 兼容（ToolList 只读取 `.percent`）。

**向后兼容**: 无破坏。

**结论**: 通过。

### 4. `Summary.tsx` — 版本对比 + 升级

**新增功能**:
- `getVersionDisplay`（L44-53）：展示版本对比，当 current != available 时显示 `current → available`。
- `handleUpgrade`（L66-96）：调用 `invoke("install_tools")` 执行升级，使用 `upgrading` Set 和 `upgradeResults` Record 管理状态。
- 升级按钮仅在 `upgradable && success && !upgraded` 时显示。

**正确性 [GOOD]**:
- 状态管理使用不可变模式（`new Set([...prev, toolName])`、`{ ...prev, [toolName]: ... }`）。正确。
- `handleUpgrade` 用 `useCallback([], [])` 无依赖，因为它只使用 setter 函数和 `invoke`，无需捕获外部变量。正确。
- `finally` 块确保 `upgrading` 状态始终清理。正确。
- catch 块创建了一个 `InstallResult` 对象，`version: null`。TypeScript 类型定义中 `version: string | null`，匹配。

**问题 [MEDIUM]**: `handleUpgrade` 调用 `invoke("install_tools", { tools: [toolName] })`。这会触发完整的 install pipeline（detect → install → verify），对于升级场景是正确的。但升级过程中没有进度反馈（进度事件会发射但 Summary 页面不监听 `install-progress`），用户只能看到"升级中..."文字。这是 UX 限制，不是 bug，但值得在后续迭代中考虑。

**问题 [LOW]**: `getVersionDisplay` 中 `currentVersion ?? result.version ?? "-"`，当 detect 和 result 都没有版本时返回 "-"。语义上可以考虑返回更有意义的文案（如"未知版本"），但 "-" 也是常见约定，可接受。

**安全性**: `invoke` 调用使用 Tauri 的 IPC 机制，参数序列化后传给后端。`toolName` 来自 `results` 数组中的 `name` 字段，是后端返回的数据，**无注入风险**。

**结论**: 通过。

### 5. `useInstaller.ts` — 安装后 re-detect

**改动**: `startInstall` 中（L80-86），安装完成后调用 `invoke("detect_tools")` 刷新工具状态。

**正确性**: 完美。catch 块静默忽略错误（非关键路径），`setTools` 更新后 Summary 页面能拿到最新的 `upgradable` 信息。

**向后兼容**: 只增加了一次额外的 detect 调用，不影响主流程。**无破坏**。

**结论**: 通过。

### 6. `ToolCard.tsx` — 版本文案优化

**改动**: `getVersionText` 函数完全重写：
- 支持 `detailText` 覆盖（用于 unavailable 状态的自定义说明）
- 已安装且版本相同："当前版本 X（已是最新）"
- 已安装且有新版本："当前版本 X → 最新版本 Y"
- 只有 current："当前版本 X"
- 只有 available + 已安装："最新版本 X"
- 只有 available + 未安装："可安装版本 X"
- 无版本："未检测到版本信息"

**正确性 [GOOD]**: 逻辑清晰，覆盖了所有组合。`isInstalled` 只判断 `installed` 和 `upgradable` 两个状态，正确。

**向后兼容**: `ToolCardProps` 新增了 `detailText` 可选属性。现有调用点不传此属性时默认 undefined，走原有版本逻辑。**无破坏**。

**结论**: 通过。

### 7. `ToolCard.test.tsx` — 测试

**覆盖率**: 参数化测试覆盖了 6 种状态组合（not_installed、installed、installed-latest、upgradable、success、failed）。额外测试了 unavailable+detailText、toggle 交互、installing 进度条。

**正确性**: 所有断言与 `getVersionText` 逻辑对齐。特别好的是测试了 `currentVersion === availableVersion` 的"已是最新"场景和 `detailText` 覆盖场景。

**问题**: 无。

**结论**: 通过。测试质量高。

### 8. `Summary.test.tsx` — 测试

**覆盖率**: 测试了基本渲染和统计计数。

**问题 [MEDIUM]**: 未测试升级功能（`handleUpgrade`、升级按钮的条件渲染、升级成功/失败状态）。`Summary` 组件新增了最复杂的交互逻辑（异步 invoke、状态管理），但测试完全没有覆盖。

**建议**: 至少添加以下测试：
1. 可升级工具显示"升级"按钮
2. 点击升级按钮后显示"升级中..."
3. 升级成功后显示"已升级 X.Y.Z"
4. 升级失败后显示"升级失败"

**结论**: 测试不完整，但不阻塞发布。

---

## 问题汇总

| 等级 | 文件 | 问题 |
|------|------|------|
| MEDIUM | Summary.test.tsx | 升级功能完全未被测试覆盖 |
| MEDIUM | Summary.tsx | 升级过程无进度反馈，仅"升级中..."文字（UX 限制） |
| LOW | useSmoothedProgress.ts | ceiling 65% vs 后端 70% 存在 5% 跳跃（视觉无感知） |
| LOW | Summary.tsx | 无版本时显示 "-"，可考虑更明确的文案 |

---

## 破坏性评估

- **ToolInstaller trait**: 签名未变。**无破坏**。
- **install-progress 事件**: 只增加了事件数量，不影响已有监听。**无破坏**。
- **ToolCard props**: 新增可选属性 `detailText`。**无破坏**。
- **Summary props**: 新增 `tools` prop。调用点（App.tsx）已同步传递。**无破坏**。
- **useInstaller 返回值**: 无变更。**无破坏**。
- **前端 progress 传递**: 从 `installer.progress` 改为 `smoothedProgress`，类型兼容。**无破坏**。

---

## 结论

**8.5 分**。三个真实问题（进度卡顿、版本文案、升级入口）都用最简方案解决。`useSmoothedProgress` 设计巧妙，用 65% ceiling + 400ms tick 解决了后端进度稀疏的问题，而不需要改动每个 installer 的内部实现。Summary 升级功能复用现有 API，零新后端代码。主要不足是 Summary 的升级逻辑缺少测试覆盖。

**建议**:
1. [建议] 补充 Summary 升级功能的测试
2. [可选] 升级过程中考虑监听进度事件
