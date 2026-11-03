# pi-agent-desktop

基于 [pi](https://github.com/earendil-works/pi) 的 Windows 桌面端。

它不是"把 pi 重做一遍成 GUI"，而是一个**薄壳**：把 pi 真正的终端界面（`pi-tui`）跑在
`node-pty` + `xterm.js` 里，外壳只负责窗口、目录与标签。这样 pi 的**扩展、斜杠命令、
skills、主题**全部原样可用 —— 这是原生 GUI 重写方案会丢掉的部分。

## 它长什么样

- 左侧「最近目录」列表，点击即在该目录开一个新标签
- 顶部标签栏：一个标签 = 一个独立的 `pi` 进程，各自带自己的工作目录和会话
- 标签内是**真实的 pi 终端界面**，占据剩余空间
- 设置、登录态、扩展、会话历史与你在终端里用的 `pi` **完全共用**（同一个 `~/.pi`）

### 快捷键

| 组合 | 作用 |
|---|---|
| `Ctrl+Shift+T` | 新建标签（弹出目录选择） |
| `Ctrl+Shift+W` | 关闭当前标签（进程仍在运行时弹确认） |
| `Ctrl+Shift+Tab` | 下一个标签（加 `Alt` 反向） |
| 中键点击标签 | 关闭该标签 |

**单 `Ctrl` 组合一律透传给终端**（`Ctrl+W` 在 pi 的输入框里是删词，`Ctrl+Tab` 也是输入），
应用级快捷键只用 `Ctrl+Shift+*`。

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Windows | 10 build 18309+ | ConPTY 最低要求 |
| Node.js（仅开发机） | **≥ 22.19** | pi 的 `engines` 要求，且用到 `node:sqlite` |
| Git Bash | 建议安装 | pi 的 `bash` 工具依赖 `bash.exe`；缺失时应用会在顶部提示 |

应用**自带** `node.exe` 与 pi，最终用户不需要装 Node。

## 快速开始

```bash
npm install     # 安装依赖
npm run setup   # 下载 Electron 二进制 + 准备自带 pi 运行时（幂等，可重复执行）
npm run dev     # 启动
```

> **`npm install` 之后必须跑一次 `npm run setup`。**
> npm 11.19+ 默认拦截依赖的 install scripts，会打印
> `3 packages have install scripts not yet covered by allowScripts`。
> 被拦下的 `electron` 后置脚本正是下载 Electron 二进制的那一步 —— 不补跑就会
> 在 `npm run dev` 时报找不到 Electron。
> `node-pty` 与 `esbuild` 不受影响：它们走 npm tarball 里的 N-API 预编译产物和
> `@esbuild/win32-x64` 平台包，本来就不需要脚本。

`npm run setup` = `node scripts/ensure-electron.mjs` + `npm run seed:runtime`，两步都幂等，
可以随时重跑。

### Electron 二进制下载不下来时

`ensure-electron.mjs` 支持标准的环境变量镜像配置：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run setup
```

也可以完全手动（版本见 `package.json` 的 `electron` 字段，当前是 `45.2.1`）：

1. 下载 `electron-v45.2.1-win32-x64.zip`
   - 官方：`https://github.com/electron/electron/releases/download/v45.2.1/electron-v45.2.1-win32-x64.zip`
   - 镜像：`https://npmmirror.com/mirrors/electron/45.2.1/electron-v45.2.1-win32-x64.zip`
2. 解压，使 `node_modules\electron\dist\electron.exe` 存在
3. 新建 `node_modules\electron\path.txt`，内容恰好是 `electron.exe`（无引号、无换行）
4. 验证：`npx electron --version` 应输出 `v45.2.1`

`seed:runtime` 做三件事，都幂等：

1. 在 `build/pi` 里安装 `@earendil-works/pi-coding-agent@1.5.0` 及其完整依赖树
2. 把当前 Node 复制成 `vendor/node/node.exe`（与开发环境同版本，避免 dev/打包行为漂移）
3. 从 `~/.pi/agent/bin` 复制 `rg.exe` / `fd.exe` 到 `vendor/tools`

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式。带 `--no-sandbox`，profile 放 `.dev-userdata/`（见下） |
| `npm run dev:plain` | 原生 `electron-vite dev`，用于验证"不需要补丁的机器" |
| `npm run setup` | `npm install` 之后的必需补步（Electron 二进制 + 自带运行时） |
| `npm run build` | 编译 main/preload/renderer 到 `out/` |
| `npm run typecheck` | 静态类型检查（`--noEmit`） |
| `npm run seed:runtime` | 只准备自带运行时 |
| `npm run diagnose` | 三轮对照诊断 Electron 启动，结果写 `build/diagnose.log` |
| `npm run dist:win` | 打出 `dist/*.zip` 与 `dist/win-unpacked/` |

### 自动打包（GitHub Actions）

`.github/workflows/build-windows.yml` 把打包搬到 GitHub 的 Windows runner 上，本机不用开着：

| 触发 | 结果 |
|---|---|
| 推送到 `main` | 跑一次完整构建，zip 作为该次运行的 Artifact 保留 14 天 |
| 打版本 tag（`0.1.0` 或 `v0.1.0` 都认） | 额外创建 GitHub Release，并把 zip 挂上去 |
| 手动 | 仓库 Actions 页 → `build-windows` → Run workflow |

产物下载：仓库 **Actions** → 点开某次运行 → 页面底部 **Artifacts** →
`pi-agent-desktop-win-x64`（里面就是 `pi-agent-desktop-<version>-win-x64.zip`）。

「编译」和「打包」是两步，失败时先看是哪一步红：`编译` 对应 `npm run build`（electron-vite），
`打包` 对应 `electron-builder`。任一步失败后，`失败诊断` 会把日志尾部 40 行写成 workflow 注解，
在 **Checks** 页面能直接看到错误原文，不用去翻原始日志。

两个 CI 专属注意点：

1. **工作流里必须保留 `npm run setup` 这一步**。`electron-builder.yml` 的 `extraResources` 指向
   `build/pi` 与 `vendor/node/node.exe`，两者都在 `.gitignore` 中、仓库里没有，必须由脚本现场生成；
   只跑 `npm ci && npm run dist:win` 会因为 extraResources 源目录缺失而失败。
2. **CI 产物不带预置的 `rg.exe` / `fd.exe`**。runner 上没有 `~/.pi/agent/bin`，
   `seed-runtime` 只告警不中断。另外 `electron-builder.yml` 目前没把 `vendor/tools` 映射到
   `resources/tools`，而 `seedManagedTools()` 在打包态正是去 `process.resourcesPath/tools` 找源文件
   ——离线使用 pi 的 grep/find 前，这两处需要一起补。

### 为什么 `npm run dev` 带 `--no-sandbox`、profile 放仓库内

这两条都是**本机实测出来的必需项**，不是通用做法。

**`--no-sandbox`**：`npm run diagnose` 三轮对照显示，不带这个开关时 Electron **浏览器进程在启动
90 毫秒后以 `0x80000003` 退出、零输出**，`main.js` 一次都不执行。在干净终端里同样如此
（`npm run dev:plain` 复现过），所以它是机器属性，不是某个终端的问题。开关只关掉 Chromium 的
进程级沙箱；渲染进程的 `webPreferences.sandbox: true`、`contextIsolation`、
`nodeIntegration: false` 全部保留。

**仓库内 profile**：Electron 在这台机器上写不了 `%APPDATA%` —— 浏览器进程报
`Lock file can not be created: 拒绝访问 (0x5)`。注意普通子进程**能**在 `%APPDATA%` 下建目录，
所以"从启动脚本里探测一下"会得出错误结论；限制出现在 Electron 自己那一层。
profile 固定放 `.dev-userdata/`，确定、可随时删、已 gitignore。用 `PI_DESKTOP_USER_DATA` 可覆盖。

### 受限终端（AppContainer 沙箱）里的第三个症状

如果启动终端本身被限制成"只能写工作区"，还会额外撞上：

| 症状 | 触发点 |
|---|---|
| 选了项目后 `EPERM: mkdir 'C:\Users\<user>\.pi\agent\sessions\...'` | pi 写 `~/.pi` 被拒 |

**正确做法：从开始菜单/任务栏重新打开一个 Windows Terminal**（不要在已被沙箱接管的
Windows Terminal 里开新标签，那会继承同一个受限身份），然后 `npm run dev`。

**不要靠"以管理员身份运行"绕过。** pi 没有内置权限系统，管理员权限下它的每一条
`bash`/`powershell` 工具调用、扩展、MCP server 都以管理员身份执行，没有 UAC 兜底。

受限终端里还有个硬约束：**只能选工作区内的项目目录**。选工作区外的目录时，pi 的
`read`/`write`/`grep` 工具会因为同样的写限制全部失败。

### agent 目录的自动降级

默认与终端共用 `~/.pi`（决策 #6）。若 `~/.pi/agent/sessions` 不可写（受限环境下 Electron
派生的进程写不进去），应用会**自动降级**到 `<userData>/pi-agent-home`：

- 复制 `settings.json` / `models.json` / `mcp.json` / `auth.json` / `trust.json` / `AGENTS.md` 等小文件
  （所以**不用重新登录**）
- 用 `--skill` / `--prompt-template` / `--theme` 把原始资源目录直接指给 pi
- 会话写在降级目录下，因此**不会出现在终端 `pi -r` 的列表里**

**已知限制**：降级模式下**已安装的 Pi 扩展包（`npm`，约 96 MB）不加载**。目录联接在受限主机上
会被拒（`EPERM`），同步复制又会让启动阻塞十几秒，所以两条路都没走。扩展在共用模式下正常。
界面顶部会显示提示条说明当前模式；要强制指定目录，设置 `PI_DESKTOP_AGENT_DIR`。

实测：降级后 pi 正常存活并落盘会话，启动约 800 ms；在此之前的表现是 spawn 后约 500 ms
`exited code=1`。

### 启动排查

主进程每个里程碑都会同时打印到终端和 `<userData>\startup.log`
（`npm run dev` 时是仓库内的 `.dev-userdata\startup.log`；`npm run dev:plain` 时是
`%APPDATA%\pi-agent-desktop\startup.log`）。启动器自己的日志在 `build\dev.log`。
日志第一行是 `main module loaded`——**没有这一行就说明 `main.js` 根本没有执行**，
问题在 Electron 启动层，与业务代码无关。

判断 pi 是否真的起来，看这两行：

```
session <id> spawning; cwd=... cols=... rows=...
session <id> spawned
```

出现 `session <id> exited code=N` 说明 pi 自己退出了，通常是 `~/.pi` 不可写。


## 目录结构

```
src/
├─ main/                   主进程
│  ├─ index.ts             窗口、生命周期、IPC、标签与关闭确认
│  ├─ pi-runtime.ts        运行时路径解析、argv/env 构造
│  ├─ pty-manager.ts       node-pty 会话表 + 环形缓冲 + resize
│  ├─ agent-home.ts        共用/降级 agent 目录与资源参数
│  ├─ preflight.ts         Git Bash 检测、rg/fd 预置
│  └─ state-store.ts       外壳自身状态（tabs / recentDirs / 窗口尺寸）
├─ preload/index.ts        contextBridge 白名单
├─ renderer/               React 19 + xterm 6
│  └─ src/
│     ├─ App.tsx           标签模型、快捷键、首次运行
│     └─ components/       TabBar / Sidebar / TerminalPane
└─ shared/ipc.ts           主进程与 preload 共用的 channel 与类型

build/pi/                  自带 pi 依赖树（gitignore）
vendor/node/node.exe       自带 Node 运行时（gitignore）
vendor/tools/*.exe         预置的 rg / fd（gitignore）
.dev-userdata/             开发期 Chromium profile（gitignore）
```

### 标签与会话的关系

标签 id 同时就是 pi 的 `--session-id`（外壳生成，形如 `ui<base36>`）。因此：

- 标签列表、`state.json`、pi 的会话文件三者天然对齐，**不需要解析 pi 的 JSONL**
- 重启后点同一个标签，`--session-id` 命中已有会话 → 接着上次继续
- 只有**当前活动的标签**才会拉起 pi 进程；切到别的标签时才为它 spawn，并回放主进程的环形缓冲
- 关闭标签不销毁会话数据，只结束进程；用 pi 的 `/resume` 仍能找回

## 几个必须知道的实现约束

- **pi 不能进 asar**：外部 `node.exe` 读不了 asar 虚拟路径，所以 pi 整棵树在
  `extraResources/pi`，是真实磁盘文件。
- **`node-pty` 必须整包 `asarUnpack`**：`conpty.dll` 是按 `.node` 文件的相对路径查找的，
  只解 `*.node` 会在第一次 spawn 时抛异常。
- **`npmRebuild: false`**：`node-pty` 用的是 N-API 预编译产物，不需要 `electron-rebuild`；
  在 Windows 上重建它反而需要 Spectre 版 MSVC 库并打 gyp 补丁。
- **`useConptyDll: true`**：绕开 node-pty 的 console-list 辅助进程（在无控制台的宿主进程里会
  `AttachConsole failed`），同时拿到正确的差分重绘。
- **`--tui-mode regular`**：`fullscreen` 会占用 alternate screen buffer，xterm 的 scrollback、
  滚轮和搜索会全部失效。
- **`PI_OFFLINE=1`**：否则 pi 每次启动都会为每个已安装扩展跑一次 `npm view <pkg> version`。
- **必须有可写的 `%TEMP%`**：pi 用 jiti 在运行时把 TS 扩展编译到 `%TEMP%\jiti\`。

## 状态

Phase 0（运行时可行性）已验证通过：自带 Node 跑起 pi 1.5.0、真实模型对话、TUI 在
ConPTY 中渲染、6 个扩展全部加载。详见 [docs/design.md](docs/design.md)。

Phase 1（骨架 + 单标签 PTY）代码已就位，**尚未运行验证**。

## 安全

pi 自身**没有权限系统**，以启动它的用户身份运行，可读写文件、执行命令、访问网络。
本应用继承这一行为。请只在你信任的项目目录里使用它。

## License

MIT
