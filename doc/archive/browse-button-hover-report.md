# browse-button-hover 审查报告

## 改动

`gui-installer/src/components/Dashboard.tsx` 单文件 +9/-1。LaunchDialog 内「选择目录」按钮新增 `browseHovered` useState，绑定 `onMouseEnter/onMouseLeave`，inline style 在 hover 时把 `background` 切到 `theme.bgHover`，并加 120ms 背景过渡。修复了原来 inline `background` 把 `.btn-secondary:hover` 的 CSS hover 给覆盖掉、按钮鼠标悬停无视觉反馈的问题。

## 审查结果（S 级 = Layer 1 + 4a + 4b）

- **Layer 1（codex 正确性）**：🟡 凑合，无致命问题。codex 明确否决了三个预设疑虑：(1) 因 LaunchDialog 是 mount/unmount 模型，`browseHovered` 每次打开都是新 useState(false)，不存在状态泄漏；(2) inline `transition` 不会让初次渲染产生动画（首帧无前值可插值）；(3) inline `background` 仅覆盖 `.btn-secondary:hover` 的 background，不影响 box-shadow（实际 `.btn-secondary:hover` 本就只改 background）。
- **Layer 4a（tsc）**：`npx tsc --noEmit` 0 错。
- **Layer 4b（vitest）**：`Dashboard.test.tsx` 14/14 全绿，5.19s。

## 非阻塞 concern

inline `transition: background-color 120ms ease` 会替换 class 上的完整 transition 列表（`background-color, color, border-color, transform`）。当前 `.btn-secondary:hover` 只改 background，无影响；若日后新增 hover 改 color/border-color/transform，那些过渡将不再平滑。属前向兼容性的小坑，本次不阻塞。

## 验收对照

四条验收条件全部满足：hover 切灰、移开还原、其他属性不变、tsc + vitest 不退化。

## 结论

**通过**。可以进入门控 + COMMIT 阶段。
