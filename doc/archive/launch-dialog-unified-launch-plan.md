# LaunchDialog 统一启动：模式下拉化 + 系统目录选择 + 启动按钮 + dangerous 去重确认

**slug**: `launch-dialog-unified-launch` · **level**: M · **stage**: plan · **branch**: main · **workflow**: v8.0

## Context

上一次提交（`0148869` / `peaceful-seeking-walrus`）已经把 LaunchDialog 重做成"上=工作目录、下=模式"的两区布局：

- 工作目录区已具备 `<select>`（最近 5 项）+ 自由输入框两种输入；
- 模式区是一组 `LaunchButton`，**点击即启动**；
- dangerous 档（codex.dangerous / claude.dangerous）走 `DangerConfirmDialog`；caution 档（gemini.yolo / opencode.allow-all）直通启动；
- 后端 `launch_ai_tool` 已经接收 `cwd: Option<String>`，TS/Rust 模式表（id/args/envs）经测试两侧严格一致。

本轮三项 UX 调整：

1. **工作目录区追加"选择目录"按钮**——调用 `tauri-plugin-dialog` 的 `open({ directory: true, defaultPath })`，让用户用系统对话框挑目录，省去手动粘贴。与现有 `<select>(recent) + <input>` 并存。
2. **启动模式改下拉式**——将 `LaunchButton` 列表换成 `<select>` 单选，选中模式下方显示完整命令预览。**点击下拉项不再触发启动**。
3. **右下角"启动"主按钮**——modal footer 增加"启动"按钮，与"取消"并列。`disabled = !selectedMode || !canLaunch`。
4. **dangerous 档去重确认**——按 `toolId` 在 `localStorage` 持久化"上次确认配置"`{ modeId, cwd }`；点启动且 `dangerLevel === "dangerous"` 时若 `(modeId, cwd)` 与上次完全一致 → 跳过 `DangerConfirmDialog` 直接启动；否则正常弹确认（确认通过后写入）。

## 决策

| 议题 | 决定 | 理由 |
|---|---|---|
| 系统对话框依赖 | **新引入** `tauri-plugin-dialog`（`@tauri-apps/plugin-dialog ^2` + `tauri-plugin-dialog = "2"`）| 这是 Tauri v2 官方 plugin，唯一稳定的"原生目录选择"路径。手动模拟 input 文件选择拿不到目录路径 |
| capability permission ID | `"dialog:allow-open"`（最小权限，仅 `open`，不暴露 save/message/confirm/ask）| Tauri v2 官方 Dialog 插件标准命名 |
| 启动按钮 disabled 条件 | `!selectedMode || !cwdInput.trim()`（cwd 必须非空 trim 后非空，且 mode 必须已选）| **用户明确指示**："cwd + mode 都必填"。`canLaunch` 既有 key 校验仍生效（保留 `canLaunch && Boolean(selectedMode) && cwdInput.trim() !== ""`） |
| cwd 是否参与 disabled | **是**——cwd 为空字符串时禁用启动按钮 | 用户决策已锁定。**主动违反 v1 默认行为**——v1 允许空 cwd 启动（落到 GUI 进程 cwd）。本次 UX 升级改为强制选目录 |
| dangerous 去重的范围 | 仅 **toolId + modeId + cwd**。**不包含** channel/key/envVars 变化 | 用户原文"该工具的上次确认配置"未提 channel；最简语义。**显式声明**：用户切 channel/key 后第二次点 dangerous 模式仍跳过确认（如果 modeId+cwd 一致）。如果产品方反悔，把 `channelId` hash 加进 entry 即可，本轮先不上 |
| `cwd` 比较 | JSON 严格相等：`null === null`、`null !== ""`、字符串原样比较（不大小写归一化）| 比较函数与存储格式对齐，无歧义 |
| 持久化失效退化 | `loadLastConfirmedLaunch` 做运行时 shape 校验（顶层为对象、entry 必须 `{modeId:string, cwd:string|null}`），任何不合规整体返回 `{}` → 视为无记录 → 走正常弹确认 | 容错优先，绝不抛错；防伪造 |
| `LaunchButton` 组件 | **删除**——`tsconfig.json` 启用 `noUnusedLocals`，留下未引用函数会让 `tsc` 失败（codex review 致命问题 1）| 简化优先；该函数仅 LaunchDialog 内部使用过，grep 全仓无其他引用 |
| 双 modal ESC 处理 | LaunchDialog 的 `useDialogKeyboard` 第一参数（`open: boolean`）改为 `!pendingLaunch`——dangerous 弹窗打开时停掉 LaunchDialog 的 ESC 监听 | codex review 致命问题 2：现有 hook 用 `window.addEventListener`，两层都活着会同时关闭 |
| 模式下拉的"预览"位置 | 下拉框正下方一行，等宽字体显示 `previewCommand(mode)`；dangerous 模式时预览框边框用 `theme.warning` 着色 | 视觉提示足够；不再加 `<option>` 文字后缀（labelKey 的"危险："前缀已说明）|
| 锁文件同步 | implement 阶段 `npm install` 自动刷新 `package-lock.json`；首次 `cargo build` 自动刷新 `Cargo.lock` | codex review 致命问题 3：plan 阶段不动锁文件，但实施时要确认两个 lock 文件一并提交 |

## 关键文件

| 文件 | 角色 |
|---|---|
| `gui-installer/src-tauri/Cargo.toml` | 加 `tauri-plugin-dialog = "2"` |
| `gui-installer/src-tauri/Cargo.lock` | 由 `cargo build` 自动刷新；提交进 commit |
| `gui-installer/src-tauri/src/lib.rs` | `Builder::default()` 之后链 `.plugin(tauri_plugin_dialog::init())` |
| `gui-installer/src-tauri/capabilities/default.json` | `permissions` 数组追加 `"dialog:allow-open"` |
| `gui-installer/package.json` | 加 `@tauri-apps/plugin-dialog: ^2` |
| `gui-installer/package-lock.json` | 由 `npm install` 自动刷新；提交进 commit |
| `gui-installer/src/lib/storage.ts` | 新增 `loadLastConfirmedLaunch / saveLastConfirmedLaunch / matchesLastConfirmedLaunch` |
| `gui-installer/src/components/Dashboard.tsx` | LaunchDialog 重排 + 父级 onPick 接入去重 + LaunchButton 删除 + useDialogKeyboard 加 active 控制 |
| `gui-installer/src/lib/strings.ts` | 新增 i18n key（2 条：launch / cwd.browse）|
| `gui-installer/src/lib/storage.test.ts` | 追加 last-confirmed 持久化测试 |
| `gui-installer/src/components/Dashboard.test.tsx` | 改写既有 6 用例 + 新增 5 用例 |

## 步骤

### 1. Tauri dialog plugin 集成（4 处源码 + 2 处锁文件自动）

#### 1a. `src-tauri/Cargo.toml`

`[dependencies]` 段追加：
```toml
tauri-plugin-dialog = "2"
```

#### 1b. `src-tauri/src/lib.rs:30`

`Builder::default()` 之后立刻链 `.plugin(...)`：
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| { ... })
```

#### 1c. `src-tauri/capabilities/default.json`

`permissions` 数组追加：
```json
"dialog:allow-open"
```

仅授予 `open` 命令——`save / message / confirm / ask` 不暴露给前端，最小权限。

#### 1d. `gui-installer/package.json`

`dependencies` 段追加：
```json
"@tauri-apps/plugin-dialog": "^2"
```

#### 1e. 锁文件（implement 阶段强制核对）

- `npm install` 后必须把 `package-lock.json` 加入 commit；
- `cargo build` 后必须把 `src-tauri/Cargo.lock` 加入 commit；
- CI/构建依赖锁文件存在；不同步会让其他开发机 `npm ci` / `cargo build --locked` 失败。

### 2. localStorage 助手 — `src/lib/storage.ts` 追加

```ts
import type { AiToolId } from "../types"; // 已有，复用

const LAST_CONFIRMED_LAUNCH_KEY = "zm_tools_last_confirmed_launch";

export interface LastConfirmedLaunch {
  modeId: string;
  cwd: string | null;
}

export type LastConfirmedLaunchMap = Partial<Record<AiToolId, LastConfirmedLaunch>>;

const KNOWN_TOOL_IDS: ReadonlyArray<AiToolId> = ["codex", "claude", "gemini", "opencode"];

export function loadLastConfirmedLaunch(): LastConfirmedLaunchMap {
  const raw = readJson<unknown>(LAST_CONFIRMED_LAUNCH_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map = raw as Record<string, unknown>;
  const out: LastConfirmedLaunchMap = {};
  for (const toolId of KNOWN_TOOL_IDS) {
    const entry = map[toolId];
    if (!entry || typeof entry !== "object") continue;
    const v = entry as { modeId?: unknown; cwd?: unknown };
    if (typeof v.modeId !== "string") continue;
    if (v.cwd !== null && typeof v.cwd !== "string") continue;
    out[toolId] = { modeId: v.modeId, cwd: v.cwd };
  }
  return out;
}

export function saveLastConfirmedLaunch(tool: AiToolId, entry: LastConfirmedLaunch): void {
  const map = loadLastConfirmedLaunch();
  map[tool] = entry;
  localStorage.setItem(LAST_CONFIRMED_LAUNCH_KEY, JSON.stringify(map));
}

export function matchesLastConfirmedLaunch(
  tool: AiToolId,
  modeId: string,
  cwd: string | null,
): boolean {
  const entry = loadLastConfirmedLaunch()[tool];
  if (!entry) return false;
  return entry.modeId === modeId && entry.cwd === cwd;
}
```

**关键点**：用 `KNOWN_TOOL_IDS` 白名单遍历，避免被恶意 key 注入（codex review 改进点 3）。

### 3. `Dashboard.tsx` LaunchDialog 重排

#### 3a. imports 调整

```ts
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  loadRecentCwds,
  matchesLastConfirmedLaunch,
  saveLastConfirmedLaunch,
} from "../lib/storage";
```

#### 3b. 删除 `LaunchButton` 函数

文件内 `function LaunchButton({...}) { ... }` 整体删除（约 720-783 行）。它已无引用方。

#### 3c. LaunchDialog 内部状态调整

```ts
function LaunchDialog({
  selectedTool, channel, apiKeys, keySelections, onSelectToolKey,
  onCancel, onPick,
  keyboardActive, // 新增 prop
}: {
  // ...原有 props
  keyboardActive: boolean;
}) {
  const dialogRef = useDialogKeyboard<HTMLDivElement>(keyboardActive, onCancel);
  // ...保留: matchingKeys / selectedKey / config / canLaunch
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [cwdInput, setCwdInput] = useState("");
  const modes = useMemo(() => getModes(selectedTool.id), [selectedTool.id]);
  const [selectedModeId, setSelectedModeId] = useState<string>(() => modes[0].id);

  useEffect(() => {
    const list = loadRecentCwds();
    setRecentCwds(list);
    setCwdInput(list[0] ?? "");
  }, []);

  const selectedMode = useMemo(
    () => modes.find((m) => m.id === selectedModeId),
    [modes, selectedModeId],
  );
  const launchEnabled = canLaunch && Boolean(selectedMode) && cwdInput.trim() !== "";

  const handleBrowseDir = async () => {
    try {
      const trimmed = cwdInput.trim();
      const picked = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: trimmed || undefined,
      });
      if (typeof picked === "string" && picked.length > 0) {
        setCwdInput(picked);
      }
    } catch {
      // 用户取消或 dev 浏览器无 plugin → 静默
    }
  };

  const handleLaunch = () => {
    if (!selectedMode || !canLaunch || cwdInput.trim() === "") return;
    onPick(selectedMode, cwdInput.trim());
  };
  // ...
}
```

**`keyboardActive` 新 prop**：父级在 `pendingLaunch !== null` 时传 `false`，dangerous 弹窗期间停用 LaunchDialog 的 ESC 监听器（codex review 致命问题 2）。

#### 3d. JSX 内容区改造

**保留**：账户 Key 区 + 工作目录区前半（select + input）。

工作目录区 input 行改为 input + browse 按钮的 flex row：
```tsx
<div className="flex gap-2">
  <input
    className="flex-1 rounded-lg border px-3 py-2 text-sm"
    onChange={(event) => setCwdInput(event.target.value)}
    placeholder={t("dashboard.cwd.placeholder")}
    style={{ ... }}
    type="text"
    value={cwdInput}
  />
  <button
    className="btn btn-secondary rounded-lg px-3 py-2 text-sm whitespace-nowrap"
    onClick={() => void handleBrowseDir()}
    style={{ ... }}
    type="button"
  >
    {t("dashboard.cwd.browse")}
  </button>
</div>
```

**删除**：原 `<section aria-label={t("dashboard.launchModeTitle")}>` 内的 `modes.map(... <LaunchButton ...>)` 列表，**替换为下拉 + 预览**：

```tsx
<section aria-label={t("dashboard.launchModeTitle")} className="grid gap-1.5">
  <h3 className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
    {t("dashboard.launchModeTitle")}
  </h3>
  <select
    aria-label={t("dashboard.launchModeTitle")}
    className="rounded-lg border px-3 py-2 text-sm"
    onChange={(event) => setSelectedModeId(event.target.value)}
    style={{ background: theme.bgSecondary, borderColor: theme.border, color: theme.textPrimary }}
    value={selectedModeId}
  >
    {modes.map((mode) => (
      <option key={mode.id} value={mode.id}>{t(mode.labelKey)}</option>
    ))}
  </select>
  {selectedMode && (
    <div
      className="rounded-md border px-3 py-2 font-mono text-xs"
      style={{
        background: theme.bgTertiary,
        borderColor: selectedMode.dangerLevel !== "safe" ? theme.warning : theme.border,
        color: theme.textSecondary,
      }}
    >
      {previewCommand(selectedMode)}
    </div>
  )}
</section>
```

**Footer 改造**：现有 `<div className="mt-4 flex justify-end">` 中只有"取消"。增加"启动"主按钮：

```tsx
<div className="mt-4 flex justify-end gap-2">
  <button
    className="btn btn-text rounded-lg px-3 py-1.5 text-sm"
    onClick={onCancel}
    style={{ color: theme.textSecondary }}
    type="button"
  >
    {t("common.cancel")}
  </button>
  <button
    className="btn btn-primary rounded-lg px-4 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
    disabled={!launchEnabled}
    onClick={handleLaunch}
    style={{
      background: selectedMode?.dangerLevel === "dangerous" ? theme.error : theme.accent,
      color: theme.textOnAccent,
    }}
    type="button"
  >
    {t("dashboard.launch")}
  </button>
</div>
```

#### 3e. 父级 Dashboard 透传 `keyboardActive`

```tsx
{selectedTool && (
  <LaunchDialog
    apiKeys={apiKeys}
    channel={currentChannel}
    keyboardActive={!pendingLaunch}      // ← 新增
    keySelections={keySelections}
    onCancel={() => setSelectedTool(null)}
    onPick={(mode, cwd) => {
      if (mode.dangerLevel === "dangerous") {
        if (matchesLastConfirmedLaunch(selectedTool.id, mode.id, cwd)) {
          onLaunch(selectedTool.id, mode.id, cwd);
          setSelectedTool(null);
          return;
        }
        setPendingLaunch({ tool: selectedTool, modeId: mode.id, cwd });
        return;
      }
      onLaunch(selectedTool.id, mode.id, cwd);
      setSelectedTool(null);
    }}
    onSelectToolKey={onSelectToolKey}
    selectedTool={selectedTool}
  />
)}
```

#### 3f. `DangerConfirmDialog onConfirm` 写入持久化

```tsx
{pendingLaunch && (
  <DangerConfirmDialog
    modeId={pendingLaunch.modeId}
    onCancel={() => setPendingLaunch(null)}    // 仅清 pendingLaunch；selectedTool 保留 → 用户回到 LaunchDialog
    onConfirm={() => {
      saveLastConfirmedLaunch(pendingLaunch.tool.id, {
        modeId: pendingLaunch.modeId,
        cwd: pendingLaunch.cwd,
      });
      onLaunch(pendingLaunch.tool.id, pendingLaunch.modeId, pendingLaunch.cwd);
      setPendingLaunch(null);
      setSelectedTool(null);
    }}
    tool={pendingLaunch.tool}
  />
)}
```

**重要**：`onCancel` 只清 `pendingLaunch`，**不清** `selectedTool` —— 用户取消危险确认后回到 LaunchDialog（仍可改 cwd/mode 重新点启动）。这是符合直觉的流程。

### 4. i18n key — `src/lib/strings.ts`

追加 2 条：

```
"dashboard.cwd.browse": "选择目录",
"dashboard.launch": "启动",
```

`StringKey` 类型由 `keyof typeof strings` 自动推导，无需手动同步。

### 5. 测试调整

#### 5a. `src/lib/storage.test.ts` 追加（5 条）

| 用例 | 预期 |
|---|---|
| `loadLastConfirmedLaunch` 空 storage | `{}` |
| `loadLastConfirmedLaunch` JSON 损坏 | `{}`（不抛）|
| `loadLastConfirmedLaunch` 含未知 toolId / 字段类型错误 | 仅返回合规 entry |
| `saveLastConfirmedLaunch` + `matchesLastConfirmedLaunch` 往返 | 同 toolId+modeId+cwd → true；任一不同 → false |
| `matchesLastConfirmedLaunch` `cwd: null` 与 `cwd: ""` 严格不等 | `null` vs `""` → false |

#### 5b. `src/components/Dashboard.test.tsx` 改写 + 新增

**改写既有 6 条**（均从"点击 LaunchButton 启动"改为"选 mode + 点'启动'按钮"）：

| 既有用例 | 调整 |
|---|---|
| `renders the full claude mode list (5 buttons)` | 改为：检查 `<select aria-label="启动模式">` 下 5 个 `<option>` 的文本 |
| `renders the full opencode mode list (2 buttons)` | 同上，2 个 `<option>` |
| `invokes onLaunch immediately for caution-level modes` | 改为：select 选 yolo → 点"启动"按钮 → onLaunch 被调一次、无 danger dialog |
| `opens the danger confirmation for codex.dangerous` | 改为：select 选 dangerous → 点"启动" → danger dialog 出现 → 勾 + 点"继续启动" → onLaunch |
| `preselects the most-recent cwd from localStorage` | 微调 textbox 数量断言（保持原有 cwd 输入框查找）|
| `forwards the entered cwd to onLaunch when launching` | 改为：填 cwd → 点"启动" → onLaunch with cwd（cwd 必填，不再覆盖空 cwd 用例）|

**新增 6 条**：

| 用例 | 预期 |
|---|---|
| dangerous 同配置去重：第一次点启动 → 弹危险确认 → 确认；第二次同 tool/mode/cwd → 直接启动不弹 | onLaunch 调 2 次、danger dialog 出现 1 次 |
| dangerous 配置变化：第一次 codex.dangerous + cwd_a 确认；第二次 cwd_b → 仍弹确认 | danger dialog 出现 2 次 |
| dangerous 跨工具不互通：codex.dangerous 确认后，claude.dangerous 仍弹 | claude 仍弹 dialog |
| 损坏 localStorage 不影响弹窗：手动 setItem 写入 `"not-json"` 后选 codex.dangerous → 仍弹 | danger dialog 正常出现 |
| 取消 DangerConfirm 后 LaunchDialog 还在：dangerous → 弹确认 → 点"取消" → LaunchDialog 仍可见，可改 cwd 重新启动 | LaunchDialog 仍在 DOM 中 |
| **cwd 必填**：清空 cwd 输入框后"启动"按钮 disabled；填非空空格 (`"   "`) trim 后仍 disabled | button.disabled === true |

**点击"选择目录"按钮**（mock plugin）：

```ts
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
```

| 用例 | 预期 |
|---|---|
| 点"选择目录"按钮 → mock open 返回 `"D:\\proj"` → input 值变为 `"D:\\proj"`；defaultPath 参数为当前 cwdInput.trim()（或 undefined） | open 被调 1 次、参数 `{directory:true, multiple:false, defaultPath:...}` |

**ESC 防止双关闭测试**（codex review 改进点 5）：可作为既有 dangerous dialog 测试的扩展——点 codex.dangerous → 弹确认 → 按 Escape → 仅 DangerConfirmDialog 关闭，LaunchDialog 仍渲染（已被"取消 DangerConfirm 后 LaunchDialog 还在"用例隐式覆盖）。

#### 5c. cargo test

无新 Rust 代码（plugin 的 `init()` 是声明式注册），现有 53 条测试不动。保持全绿。

## 验证

1. `cd gui-installer && npm install` —— 拉取 `@tauri-apps/plugin-dialog`，刷新 `package-lock.json`
2. `cd gui-installer && npm test` —— vitest 全绿（45 + 5 新 storage + 5 新 Dashboard + 1 browse = ~56 条）
3. `cd gui-installer && npx tsc --noEmit` —— 0 错误（特别验证 LaunchButton 删除后无未引用代码）
4. `cd gui-installer/src-tauri && cargo test` —— 53/53；首次 `cargo build` 会刷新 `Cargo.lock`
5. `cd gui-installer && npm run build` —— tsc + vite build 全过
6. `powershell -ExecutionPolicy Bypass -File .\build-windows-gnu.ps1` —— 出 `dist/gui-installer.exe`
7. 手动验收：
   - 打开 codex 启动弹窗 → 工作目录区有 select + input + "选择目录"按钮；模式区是下拉 + 命令预览；footer 有"启动"按钮
   - 点"选择目录" → 系统目录对话框弹出 → 选目录 → input 自动填路径
   - 模式下拉切换 → 预览实时变化、不触发启动
   - 清空 cwd → "启动"按钮禁用（hover 显示 disabled cursor）
   - 选 codex.dangerous → 点启动 → DangerConfirmDialog 弹 → 勾 + 确认 → 启动；再次同配置点启动 → 跳过确认直接启动
   - DangerConfirm 弹出时按 ESC → 只关确认框，LaunchDialog 仍在
   - 改 cwd 后再选 codex.dangerous → 重新弹确认（modeId 同但 cwd 异）
   - 关闭 wt 重开应用，重复 dangerous 同配置 → 跳过确认（持久化生效）

## 风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| `@tauri-apps/plugin-dialog` 与 `tauri-plugin-dialog` 版本不匹配 | 中 | 都锁 `^2`（major 一致），首次 `npm install` / `cargo build` 失败立即可见 |
| capability `"dialog:allow-open"` 拼写错误致 invoke 抛 permission denied | 低 | Tauri v2 标准命名；如失败可回退 `"dialog:default"`（含 open + save + message + confirm + ask）|
| dev mode（vite dev 浏览器）下 `open()` 抛 "Tauri API not available" | 低 | `handleBrowseDir` 已 try/catch；测试 mock 整个 module |
| `LastConfirmedLaunch` 存储被恶意构造导致 type confusion | 极低 | 白名单 `KNOWN_TOOL_IDS` + 字段类型校验 |
| 用户在 input 框手动输入"和上次完全一致"的 cwd → 跳过确认；但用户可能本意想看一眼弹窗 | 低 | 用户已显式要求"配置一致跳过"。提供"清除上次确认"入口属过度设计，本轮不做 |
| 切换 channel/key 后 dangerous 模式被去重跳过 | 中 | **有意设计**——entry 不含 channelId/keyHash。文档已声明；如需提升再加 |
| 锁文件遗漏 commit 导致他机 `npm ci` / `cargo build --locked` 失败 | 中 | 验证步骤 1/4 强制要求；commit 前 `git status` 必看到 lock 文件 |
| `<select>` 高亮态与 `recentCwds.includes(cwdInput)` 大小写敏感比较——v1 既有 concern `cwd-select-case-mismatch`，本轮不修 | 低 | 与本任务无关，避免范围蔓延 |
| `selectedTool` + `pendingLaunch` 双 state 仍并存（dangerous 路径）| 低 | 通过 `keyboardActive={!pendingLaunch}` 隔离 ESC；其余交互用户已可在 cancel 后回到 LaunchDialog |

## codex 计划审查反馈整合

`codex.cmd exec --dangerously-bypass-approvals-and-sandbox`（输入 prompt 见 `Temp/codex_review_prompt.txt`，输出见 `Temp/codex_review_out.txt` 第 2189-2225 行）反馈三个致命问题 + 五条改进，全部整合：

**致命问题（修正）**：
1. `LaunchButton` 留着会被 `tsc --noUnusedLocals` 报错 → **改为删除**（步骤 3b）；
2. dangerous 弹窗期间双 modal 都挂 ESC 监听 → **新增 `keyboardActive` prop 隔离**（步骤 3c/3e）；
3. 锁文件没说同步 → **步骤 1e 显式要求** `package-lock.json` + `Cargo.lock` 同提交。

**改进点（采纳）**：
4. disabled 条件用 `!selectedMode || !canLaunch` 与 handler 对齐 → 步骤 3c handleLaunch + 决策表；
5. dangerous 去重不含 channel/key —— 决策表显式声明这是"有意设计"；
6. `loadLastConfirmedLaunch` 运行时 shape 校验 + 白名单 toolId → 步骤 2；
7. `defaultPath: cwdInput.trim() || undefined`（与 launch cwd 对齐）→ 步骤 3c handleBrowseDir；
8. 测试新增"取消 DangerConfirm 后 LaunchDialog 还在"+"损坏 localStorage 仍弹"→ 步骤 5b。

## Acceptance criteria 映射

| state.json acceptance_criteria | 落点 |
|---|---|
| 工作目录区三种输入方式（dropdown / input / 选择目录按钮） | 步骤 3d |
| 启动模式 `<select>`，不再点击模式启动 | 步骤 3d JSX 替换 + 测试 5b 改写 |
| 右下角"启动"按钮 disabled 条件 | 步骤 3c/3d footer + 决策表 |
| dangerous 去重 | 步骤 3e/3f + 步骤 2 storage 助手 + 测试 5b 新增 5 条 |
| tauri-plugin-dialog 4 处集成完整 | 步骤 1a-1d（+ 1e 锁文件）|
| 测试覆盖新行为 | 步骤 5a/5b |
| vitest + cargo test 全绿 | 验证 2 / 4 |
