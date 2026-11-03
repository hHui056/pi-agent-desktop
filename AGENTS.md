# pi-agent-desktop 协作说明（AGENTS.md）

> 本文件是给 AI 协作者的行为约束 + 事实索引，不是使用说明。使用/构建/排查细节看 [README.md](README.md)，
> 所有"为什么这样做"看 [docs/design.md](docs/design.md)（决策 #1–#26b，每条都有验证记录）。

## 1. 一句话定位

Windows 桌面"薄壳"：把 pi coding agent 的**真实终端界面**（pi-tui）跑在 `node-pty` + `xterm.js` 里，
外壳只负责窗口、标签与目录导航。不重画聊天界面——pi 的扩展、斜杠命令、skills、主题因此 100% 原样可用。
仅 Windows、自用、不签名不自动更新（design.md 决策 #1–#3）。

## 2. 技术栈（均来自文件）

- Electron **45.2.1**（证据：`package.json:36`），内置 Node 24.22.1
- 构建：`electron-vite` **5.0.0** + Vite 7.2.2 + TypeScript **5.9.3**（strict，`--noEmit`）
- 渲染层：React **19.2.0** + `@xterm/xterm` **6.0.0**（fit / webgl / web-links 三个 addon）
- PTY：`node-pty` **1.1.0**，N-API 预编译产物，`npmRebuild: false`（`electron-builder.yml:12`）
- 开发机 Node ≥ **22.19.0**（`package.json:9`；`scripts/seed-runtime.mjs` 启动时强制校验）
- pi 本体：`@earendil-works/pi-coding-agent@1.5.0`，vendored 到 `build/pi/`，用**外部
  `vendor/node/node.exe`** 执行——绝不用 `ELECTRON_RUN_AS_NODE`（design.md 决策 #7）

## 3. 目录地图

| 路径 | 作用 |
|---|---|
| `src/main/index.ts` | 主进程入口：窗口、生命周期、IPC 注册、标签关闭确认、启动日志 |
| `src/main/pi-runtime.ts` | 运行时路径解析、pi 的 argv/env 构造（`buildPiArgs`/`buildPiEnv`）、`createSessionId` |
| `src/main/pty-manager.ts` | node-pty 会话表 + 512 KiB 环形缓冲（供 renderer 重载回放）+ resize |
| `src/main/agent-home.ts` | `~/.pi` 共用 / 不可写时自动降级镜像（复制小配置，`--skill` 等指向原目录） |
| `src/main/preflight.ts` | Git Bash 检测；`rg.exe`/`fd.exe` 预置到 `~/.pi/agent/bin` |
| `src/main/state-store.ts` | 外壳自身状态 `state.json`（tabs/recentDirs/窗口尺寸），与 pi 的 `~/.pi` 分离 |
| `src/preload/index.ts` | `contextBridge` 白名单（`window.piDesktop`） |
| `src/renderer/src/App.tsx` | 标签模型、`Ctrl+Shift+*` 快捷键、首次运行/降级/Git Bash 提示条 |
| `src/renderer/src/components/` | `Sidebar` / `TabBar` / `TerminalPane`（xterm 实例、WebGL→DOM 降级、回放拼接） |
| `src/shared/ipc.ts` | 主进程与 preload 共用的 channel 名与类型 |
| `scripts/dev-nosandbox.mjs` | dev 启动器（本机必需：`--no-sandbox` + 仓库内 profile） |
| `scripts/seed-runtime.mjs` | 装 pi 依赖树到 `build/pi`、复制 node.exe、预置 rg/fd（幂等） |
| `scripts/ensure-electron.mjs` | 补下载 Electron 二进制（幂等，支持 `ELECTRON_MIRROR`） |
| `scripts/diagnose.mjs` | 三轮对照诊断 Electron 启动，结果写 `build/diagnose.log` |
| `build/pi/` `vendor/` `.dev-userdata/` `.npm-cache/` `.electron-cache/` `downloads/` | 全部 gitignore 的生成物/自带运行时/缓存 |

## 4. 常用命令（只列出，不代为执行）

| 目的 | 命令 | 备注 |
|---|---|---|
| 开发启动 | `npm run dev` | 本机唯一可用方式：`--no-sandbox` + profile 在 `.dev-userdata/`（原因见 README「几个必须知道」） |
| 类型检查 | `npm run typecheck` | 两套 tsconfig（main/preload + renderer），改完代码先跑这个 |
| 首次/补环境 | `npm run setup` | `npm install` 之后**必须**跑一次（Electron 二进制 + 自带运行时），幂等 |
| 只补运行时 | `npm run seed:runtime` | 幂等 |
| 编译产物 | `npm run build` | 输出到 `out/` |
| 打包 | `npm run dist:win` | 出 `dist/*.zip` 与 `dist/win-unpacked/` |
| 启动诊断 | `npm run diagnose` | Electron 起不来时用 |

## 5. 代码约定

- 两套 tsconfig 都开 `strict` + `noUnusedLocals` + `noUnusedParameters`（`tsconfig.json` / `tsconfig.web.json`）；无 ESLint/Prettier 配置，风格靠对齐现有代码。
- renderer 路径别名 `@renderer/*` → `src/renderer/src/*`（`electron.vite.config.ts:21` 与 `tsconfig.web.json:20` 双处声明，改一处要同步另一处）。
- main 进程按职责单文件拆分（见目录地图）；**注释里的决策编号（如 `Decision #9`）是文档的一部分**，改行为必须同步注释和 design.md。
- 主进程统一用 `log()` 打点（stdout + `<userData>/startup.log`），新代码路径的关键里程碑也要打点——排查依赖它。
- **tab id 就是 pi 的 `--session-id`**，形如 `ui<base36 时间戳><随机>`；目前 `src/main/pi-runtime.ts:52` 与 `src/renderer/src/App.tsx:16` 各有一份实现，改动需两处同步，且必须满足 pi 的字符约束（首尾字母/数字，中间 `.\_-`）。
- UI 文案用中文；错误兜底原则：状态文件损坏、日志失败、fit 抛错都不允许阻塞启动。
- IPC 新增时三处同步：`src/shared/ipc.ts`（channel+类型）、`src/main/index.ts`（handler）、`src/preload/index.ts`（桥接）。

## 6. 硬性禁止与已知坑

| 项 | 现象（若违反） | 原因 | 正确做法 |
|---|---|---|---|
| 不用 `ELECTRON_RUN_AS_NODE` 跑 pi | 从 pi 启动的任意 Electron 退化成 Node；`isElectron()` 分支错乱 | env 会泄漏进 pi 的孙子进程（决策 #7） | 保持外部 `node.exe` + `buildPiEnv` 里已 `delete` 该变量 |
| 不重编 `node-pty`（保持 `npmRebuild: false`） | Windows 上需要 Spectre 版 MSVC + gyp 补丁 | tarball 自带 N-API 预编译（`electron-builder.yml:9-12`） | 直接用预编译产物 |
| 不去掉 `useConptyDll: true`（`pty-manager.ts:51`） | 无控制台宿主里 `AttachConsole failed`；只剩全量重绘 | 绕开 node-pty 的 console-list 辅助进程（决策 #24） | 保留该选项 |
| 不去掉 `--tui-mode regular`（`pi-runtime.ts:60-63`） | fullscreen 占用 alternate screen，xterm 滚动/搜索全部失效（决策 #9） | — | 保留 |
| 不删 `PI_OFFLINE=1` / `PI_SKIP_VERSION_CHECK=1`（`pi-runtime.ts:104-105`） | 每次启动对每个扩展跑 `npm view`，明显拖慢 | 决策 #25 | 保留 |
| 打包时保持 `node-pty` **整包** `asarUnpack`（`electron-builder.yml:26-27`） | 第一次 spawn 抛异常 | `conpty.dll` 按 `.node` 文件相对路径查找，只解 `*.node` 不够 | 不改 `asarUnpack` 规则 |
| dev 不用 `npm run dev:plain` 替代 `npm run dev` | 浏览器进程 90 ms 后以 `0x80000003` 退出、零输出 | 本机机器属性，`diagnose` 三轮验证过 | `dev:plain` 仅用于验证"无补丁机器" |
| 不用管理员权限跑 | pi 无权限系统，其 `bash` 工具、扩展全部以管理员执行，无 UAC 兜底 | README「启动排查」明令 | 换普通终端；`~/.pi` 不可写时靠 agent-home 自动降级 |
| 应用级快捷键只用 `Ctrl+Shift+*` | 单 `Ctrl` 组合是终端输入（如 pi 里 `Ctrl+W` 删词） | 决策 #19 | 新快捷键走 `Ctrl+Shift`，在 `App.tsx` 的 keydown 里加 |
| 不向 pi 子进程透传 `NODE_OPTIONS` / `PI_CODING_AGENT_DIR` | 打包 Electron 对 NODE_OPTIONS 有白名单；agent 目录被静默分流 | `buildPiEnv` 显式删除（`pi-runtime.ts:94-97`） | 新 env 变量沿用同款"继承后删敏感项"写法 |

## 7. 常见任务索引

| 要改什么 | 动哪里 |
|---|---|
| IPC 协议 | `src/shared/ipc.ts` → `src/main/index.ts` → `src/preload/index.ts`（三处同步） |
| pi 启动参数 / 环境变量 | `src/main/pi-runtime.ts`（`buildPiArgs` / `buildPiEnv`），启动日志会打印实际值 |
| agent 目录 / 降级镜像 | `src/main/agent-home.ts`（`MIRROR_FILES`、`RESOURCE_FLAGS`） |
| 标签恢复 / 外壳状态 | `src/renderer/src/App.tsx` + `src/main/state-store.ts` |
| 终端渲染 / 回放 | `src/renderer/src/components/TerminalPane.tsx`（环形缓冲拼接注意 `replayMark` 逻辑） |
| 打包内容 | `electron-builder.yml`（`files` / `asarUnpack` / `extraResources`） |
| 自带运行时 / 预置工具 | `scripts/seed-runtime.mjs` + `src/main/preflight.ts` |
| 设计依据 | `docs/design.md`——改行为前先核对对应决策编号 |

## 8. 待确认

- **Phase 1 验证状态矛盾**：`README.md` 状态节写"Phase 1 骨架代码已就位，尚未运行验证"，而
  `docs/design.md`「四之三」记录了 Phase 1 已在真实运行中跑通（含 startup.log 摘录）。两处必有一处过期
  （git 里 README.md 有未提交修改），需要人工确认以哪个为准后统一。
- `scripts/diagnose.mjs` 的具体三轮流程未逐行核对（README/design.md 只描述了用途与结论）。
