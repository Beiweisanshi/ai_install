# 添加 Nushell 安装包到分发目录

**任务级别**: M (3-5 文件改动，新增独立资源，不改架构)

**日期**: 2026-03-24

---

## 根因分析

**分析模式**: 缺失资源 + 配置不一致

**置信度**: 95%

### 问题本质

`dist/package-windows/packages/windows/` 目录缺少 `nushell-*.msi` 安装包。现有三个安装包（Git、Node.js、CC-Switch）都已就位，唯独 Nushell 缺失。

这导致：
1. GUI 安装器的 `find_package(&windows_packages_dir()?, "nushell-*.msi")` 会返回 `PackageNotFound` 错误
2. Nushell TUI 安装器的 `deploy-nu.bat` 中 `for %%f in (packages\windows\nushell-*.msi)` 匹配失败
3. `detect.rs` 中 `get_available_version_from_packages("Nushell", ...)` 返回 None，UI 显示 "Missing local package"

checksums.json 中已有 `nushell-0.111.0-x86_64-pc-windows-msvc.msi` 的 SHA256，但对应的实际文件不存在。

### 根因

打包分发时遗漏了 Nushell MSI 文件。其他所有工具的安装包都已正确放置。

---

## 影响范围

| 层级 | 影响项 | 说明 |
|------|--------|------|
| **分发包** | `dist/package-windows/packages/windows/` | 需要放入 nushell MSI |
| **校验清单** | `dist/checksums.json`, `dist/package-windows/checksums.json`, `gui-installer/checksums.json` | 如果 MSI 文件版本或 hash 与现有条目不同，需要更新 |
| **安装脚本** | `deploy-nu.bat`, `deploy-nu.sh` | 已有 Nushell 安装逻辑，只要包存在就能工作，**无需改代码** |
| **Nushell 脚本** | `nu/install_win.nu`, `nu/install_mac.nu` | 已有完整 Nushell 安装逻辑，**无需改代码** |
| **GUI 安装器** | `windows.rs`, `macos.rs`, `commands.rs`, `detect.rs` | 已有完整 Nushell Installer 实现，**无需改代码** |
| **deploy.ps1** | Windows PowerShell 脚本 | 不包含 Nushell 安装逻辑（Nushell 由 deploy-nu.bat bootstrap），**无需改动** |
| **deploy.sh** | macOS Bash 脚本 | 不包含 Nushell 安装逻辑，**无需改动** |

**关键发现：所有安装脚本和 GUI 安装器代码已经完整支持 Nushell 安装。** 问题纯粹是分发包中缺少实际的安装文件。

---

## 方案

### 第 1 步：获取 Nushell 安装包

**Windows**: 从 https://github.com/nushell/nushell/releases 下载对应版本的 MSI
- 文件名格式: `nushell-{version}-x86_64-pc-windows-msvc.msi`
- checksums.json 中已记录 `nushell-0.111.0-x86_64-pc-windows-msvc.msi`，SHA256 = `5db6396c280b51acd2b66892e49e48a3f55016bd7314bb80d8c3d1f88dc57487`
- 如果使用更新版本，需要同步更新 checksums.json

**macOS**: 从同一 Release 页下载 tar.gz
- 文件名格式: `nu-{version}-x86_64-apple-darwin.tar.gz` 或 `nu-{version}-aarch64-apple-darwin.tar.gz`
- deploy-nu.sh 和 macos.rs 中匹配模式: `nu-*-apple-darwin*.tar.gz` / `nushell-*.tar.gz`

### 第 2 步：放置安装包

```
dist/package-windows/packages/windows/nushell-{version}-x86_64-pc-windows-msvc.msi
```

macOS 包放入（如需构建 macOS 分发包）:
```
packages/macos/nu-{version}-{arch}-apple-darwin.tar.gz
```

### 第 3 步：更新 checksums.json（如版本变更）

如果下载的 MSI 版本与 checksums.json 中记录的 0.111.0 不同，需要更新以下三个 checksums.json:
- `dist/checksums.json`
- `dist/package-windows/checksums.json`
- `gui-installer/checksums.json`

计算方式: `sha256sum nushell-{version}-x86_64-pc-windows-msvc.msi`

### 第 4 步：验证

1. 确认 GUI 安装器 detect 能识别到 available_version
2. 确认 `deploy-nu.bat` 中 `for %%f in (packages\windows\nushell-*.msi)` 能匹配
3. 确认 checksums 校验通过

---

## 测试用例

| # | 场景 | 预期结果 |
|---|------|----------|
| T1 | GUI 安装器启动后检测工具列表 | Nushell 行显示 available_version（非 "Missing local package"） |
| T2 | GUI 安装器选择安装 Nushell | MSI 静默安装成功，verify 阶段 `nu --version` 返回版本号 |
| T3 | `deploy-nu.bat` 在无 Nushell 环境运行 | 自动找到 MSI 并静默安装，然后启动 deploy.nu |
| T4 | SHA256 校验 | `verify_package_hash()` 对 MSI 文件校验通过 |
| T5 | checksums.json 一致性 | 三个 checksums.json 文件中 Nushell 条目的文件名和 hash 完全一致 |
| T6 | Nushell 已安装时跳过 | 所有入口（GUI / deploy-nu.bat / deploy.nu）检测到已安装后跳过安装 |

---

## 操作清单

- [ ] 下载 `nushell-0.111.0-x86_64-pc-windows-msvc.msi`（或最新稳定版）
- [ ] 验证 SHA256 与 checksums.json 一致
- [ ] 复制到 `dist/package-windows/packages/windows/`
- [ ] 如果版本不同：更新三个 checksums.json
- [ ] 如果需要 macOS 支持：下载 tar.gz 并放入 `packages/macos/`
- [ ] 运行 GUI 安装器验证 Nushell 检测和安装
