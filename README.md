# AI 工具链自动部署器

一键安装 Claude CLI、Codex CLI、Gemini CLI 及其依赖，支持 Windows 和 macOS。

## 安装的工具

| 工具 | Windows 安装方式 | macOS 安装方式 |
|------|-----------------|---------------|
| Git | 本地安装包 (packages/) | Homebrew |
| Node.js (LTS) | 本地安装包 (packages/) | 本地 .pkg 或 Homebrew |
| Claude CLI | npm (npmmirror) | npm (npmmirror) |
| Codex CLI | npm (npmmirror) | npm (npmmirror) |
| Gemini CLI | npm (npmmirror) | npm (npmmirror) |
| CC Switch | 本地安装包 (packages/) | 本地 .dmg 或 Homebrew |

## 目录结构

```
ai_部署/
├── deploy.bat              # Windows 双击入口
├── deploy.ps1              # Windows 核心逻辑
├── deploy.sh               # macOS 脚本
├── packages/
│   ├── windows/            # Windows 安装包
│   │   ├── Git-2.x.x-64-bit.exe
│   │   ├── node-v22.x.x-x64.msi
│   │   └── cc-switch-x.x.x-Setup.exe
│   └── macos/              # macOS 安装包
│       ├── node-v22.x.x.pkg       (可选，没有则用 brew)
│       └── cc-switch-x.x.x.dmg    (可选，没有则用 brew)
└── README.md
```

## 准备安装包

运行前，先把安装包放到 `packages/` 对应目录：

**Windows (必须)**:
- Git: 从 https://git-scm.com/download/win 下载 `Git-*-64-bit.exe`
- Node.js: 从 https://nodejs.org 下载 `node-*-x64.msi` (LTS)
- CC Switch: 从 https://github.com/farion1231/cc-switch/releases 下载 `.exe`

**macOS (可选，没有会用 brew)**:
- Node.js: 从 https://nodejs.org 下载 `.pkg`
- CC Switch: 从 GitHub Release 下载 `.dmg`

## 使用方法

### Windows

双击 `deploy.bat`（会自动请求管理员权限）

### macOS

```bash
chmod +x deploy.sh
./deploy.sh
```

## 特性

- **离线安装**: Git/Node/cc-switch 从本地 packages/ 安装，不下载
- **在线安装**: Claude/Codex/Gemini 通过 npm 安装（npmmirror 镜像加速）
- **幂等**: 已安装的跳过，需更新的更新
- **错误隔离**: 单个工具失败不影响其他工具

## 常见问题

**Q: 提示找不到安装包？**
A: 确保安装包放在 `packages/windows/` 或 `packages/macos/` 目录下，文件名匹配上述模式。

**Q: npm install 很慢？**
A: 已使用 `--registry https://registry.npmmirror.com/` 加速，不修改全局配置。

**Q: 安装完后命令找不到？**
A: 关闭并重新打开终端。
