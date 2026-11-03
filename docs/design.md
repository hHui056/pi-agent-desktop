# 设计决策与验证记录

本文是 pi-agent-desktop 的"为什么这样做"。所有结论都对应一次可复现的验证或一条有出处的
事实；未经验证的标为「待验证」。

## 一、产品定位

| # | 决策 | 结论 |
|---|---|---|
| 1 | 定位 | 自用/小圈子，不签名、不自动更新、不崩溃上报 |
| 2 | 平台 | 仅 Windows |
| 3 | 形态 | **薄壳**：真 `pi` TUI 跑在 xterm 里，外壳只管导航 |
| 4 | 上游关系 | 只依赖 npm 包，不 fork、不打补丁 |
| 5 | 参照 | 从零自建，抄 `pi-gui` 的打包配置 |
| 6 | 与命令行关系 | 共用 `~/.pi`，登录态/扩展/设置完全一致 |

选薄壳的根本理由：pi 的扩展、斜杠命令、主题都是**渲染在 `pi-tui` 里的**。用 React 重画一套
聊天界面，扩展提供的 UI 会全部失效；而把真 TUI 放进 xterm 能 100% 保留生态。

## 二、运行时

| # | 决策 | 结论 |
|---|---|---|
| 7 | pi 用什么跑 | 自带 `node.exe`，**不用** `ELECTRON_RUN_AS_NODE` |
| 8 | Electron | 45.x（内置 Node 24.22.1，EOL 2027-04） |
| 9 | TUI 渲染模式 | 默认 `--tui-mode regular`，留开关 |
| 10 | 预置工具 | `rg`/`fd` 拷进 `~/.pi/agent/bin/`（缺失才拷） |
| 11 | 自更新 | pi 在嵌入安装下自带拒绝逻辑；另设 `PI_SKIP_VERSION_CHECK=1` |
| 12 | 首屏预检 | 仅检测 Git Bash，缺失给提示 |

**为什么不用 `ELECTRON_RUN_AS_NODE`**（三条独立证据）：

1. 该环境变量会泄漏到 pi 的孙子进程 —— pi 天天通过 `bash`/`powershell` 工具跑 `git`、`npm`、
   任意脚本，任何一个从 pi 启动的 Electron 应用都会退化成 Node 模式。
2. `process.versions.electron` 为真值，依赖里的 `isElectron()` 判断会走桌面分支去找不存在的
   `app` 模块。
3. 打包后的 Electron 对 `NODE_OPTIONS` 有白名单限制。

`utilityProcess.fork` 也不是替代品：官方文档明确 **stdin 只能为 `ignore`**，无法承载 TTY。

## 三、外壳

| # | 决策 | 结论 |
|---|---|---|
| 13 | 技术栈 | React 19 + Vite + TS + `electron-vite` |
| 14 | 导航 | 左侧最近目录 → 右侧标签，每标签一个独立 pi 进程 |
| 15 | PTY 归属 | 主进程持有 + 环形缓冲，renderer 重载自动重连回放 |
| 16 | 会话身份 | 外壳生成 `--session-id`，重启精确恢复且零 JSONL 解析 |
| 17 | 应用状态 | `app.getPath('userData')` |
| 18 | 标题栏 | 系统原生 |
| 19 | 快捷键 | 应用级一律 `Ctrl+Shift+*`，单 `Ctrl+*` 全透传 |
| 20 | 退出 | 有活跃会话时弹确认 |
| 21 | 出包 | `zip`（主）+ `dir`（调试） |
| 22 | 隐含假设 | 单窗口、深色主题、无外壳设置界面 |
| 23 | 隐含假设 | 最小窗口约 100×30 列行（pi 终端层不做钳制，回落 80×24） |

## 四、Phase 0 冒烟结果（已验证）

环境：Windows，Node v26.7.0，`~/.pi` 已有登录态与 6 个扩展包，自定义端点
`http://localhost:7864/v1`。

| 验证项 | 结果 |
|---|---|
| 自带 `node.exe` 跑 pi | `--version` → `1.5.0`，exit 0 |
| CLI 入口 | `package.json` 的 `bin.pi` = `dist/bundle/cli.js` |
| 真实模型调用 | `--print "只回复两个字符：OK"` → `OK`，exit 0 |
| TUI 在 ConPTY 渲染 | 标题栏、π logo、状态行全部绘出 |
| truecolor / DEC 2026 / OSC 8 | 均出现 |
| `--tui-mode regular` | 无 alternate screen，xterm scrollback 可用 |
| 6 个扩展加载 | `[Extensions]` 面板列出全部，零报错 |
| slash 命令与 skills | `/council`…`/review-loop`、16 个 skills |
| `node-pty` 预编译 | win32-x64 预编译在 Node 26 下直接加载，无需 rebuild |
| 关标签后进程 | 无僵尸残留 |

### 由证据推导的两条补充决策

| # | 决策 | 证据 |
|---|---|---|
| 24 | `useConptyDll: true` | 默认 ConPTY 后端会触发 node-pty 的 console-list 辅助进程 `AttachConsole failed`，且只有全量重绘；改用内置 `conpty.dll` 后报错消失、拿到 17 片增量重绘 |
| 25 | `PI_OFFLINE=1` | 未设时每启动执行 6 次 `npm view <pkg> version`；设后归零，且扩展照常加载、模型调用照常可用 |
| 26 | agent 目录自动降级 | `~/.pi/agent/sessions` 可写则共用（决策 #6 不变）；不可写则改用 `<userData>/pi-agent-home`，复制 7 个小配置/凭证文件，并用 `--skill`/`--prompt-template`/`--theme` 指向原始资源目录。实测：降级后 pi 正常存活并落盘会话（此前是 spawn 后 500 ms `exited code=1`）；启动耗时约 800 ms |
| 26b | 不镜像 `npm`（扩展包，96 MB） | 目录联接在受限主机上被拒（`EPERM`），同步复制会把启动阻塞十几秒（实测卡在拷贝 17 MB 时启动不再推进）。代价：降级模式下已安装的 Pi **扩展包**不加载，skills/prompts/themes 通过 CLI 参数正常工作 |

## 四之三、Phase 1 验证结果（已验证）

骨架 + 单标签 PTY 在真实运行中跑通，日志（`startup.log`）：

```
main module loaded; electron=45.2.1 node=24.22.1
app ready; userData=...\pi-agent-desktop
runtime node=...\vendor\node\node.exe
runtime pi=...\pi-coding-agent\dist\bundle\cli.js
git bash: C:\Program Files\Git\bin\bash.exe
ipc registered; creating window
loading renderer from http://localhost:5173
renderer console: [vite] connected.
window ready-to-show
renderer did-finish-load
session uimw0enmbdrwznkv spawning; cwd=F:\Git\pi-agent-desktop cols=144 rows=36
session uimw0enmbdrwznkv spawned
```

pi 随后在 `~/.pi/agent/sessions/--F--Git-pi-agent-desktop--/` 落盘了会话文件，证明 PTY 子进程、
工作目录、会话参数三者都正确。

**环境陷阱（与代码无关，但会伪装成代码 bug）：** 若启动终端被 AppContainer 沙箱限制成"只能写
工作区"，会依次表现为 Chromium 沙箱初始化失败（`0x80000003`，90 ms，零输出）→ profile 写入
失败（`0xFFFF7003`）→ pi 无法写 `~/.pi`（`EPERM`）。三个症状同一个根因。`npm run dev` 内置了
前两个的兜底（`--noSandbox` + `.dev-userdata/`），第三个只能换终端解决。

**不要用管理员权限绕过**：pi 没有权限系统，管理员权限下它的每条 `bash` 工具调用都以管理员
身份执行，没有 UAC 兜底。

## 五、风险台账

| 级别 | 风险 | 现状 / 缓解 |
|---|---|---|
| ~~最高~~ | 自带 Node 运行时无先例 | **已解除**：Phase 0 跑通 |
| 高 | `conpty.dll` 按 `.node` 相对路径查找 | 整包 `asarUnpack` + `useConptyDll` |
| 高 | xterm 6 删除 canvas 渲染器 | WebGL addon + DOM 兜底 + `onContextLoss` |
| 中 | 窗口缩放：pi 的 SIGWINCH 在 win32 是 no-op | xterm `fit` + `ResizeObserver` 主动调 `pty.resize()` |
| 中 | 未知 `--长参数` 被静默吞掉（pi 当成扩展参数） | 参数集中在 `pi-runtime.ts`，启动日志打印实际路径 |
| 中 | `%TEMP%` 必须可写 | jiti 运行时编译 TS 扩展到这里 |
| 中 | pi 的方言：`--print`/JSON/RPC 都要求 stdout 是协议通道 | 交互模式本身用 PTY，不碰这些模式 |
| 低 | Electron 每 8 周发版、EOL 早 | 版本钉死，升级单开一轮 |
| 低 | pi **零权限系统** | 自用可接受，README 已声明 |

## 六、非目标（明确不做）

- 不做原生聊天界面（会丢扩展 UI 兼容性）
- 不做 RPC 旁路做指标面板（V1；双进程双状态会让调试难度翻倍）
- 不做会话侧栏读 pi 的 JSONL（改用 `--session-id` 精确恢复）
- 不做代码签名 / 自动更新 / 崩溃上报
- 不做多窗口、托盘常驻、全局热键

## 七、事实来源

- pi 仓库与文档：`docs/cli.md`、`docs/session-format.md`、`docs/environment-variables.md`、
  `docs/windows.md`、`src/config.ts`、`src/core/session-manager.ts`、`src/main.ts`
- Electron 版本线：`releases.electronjs.org`、`electron-timelines`
- `node-pty@1.1.0` 的 npm tarball 内 `prebuilds/win32-x64`
- xterm.js 6.0.0 release notes（canvas renderer 移除、DEC 2026 支持）
- electron-builder v26 文档（`asarUnpack` / `extraResources` / `portable` 取舍）
- 同类实现参考：`pi-gui`、`coide`、`hiboard`、`BitFun`、`Cate`、`kmux`
