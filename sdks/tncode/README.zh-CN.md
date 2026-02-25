# tncode VS Code 扩展

tncode 使用独立的 VS Code 扩展和完全独立的前端 UI，同时共享 opencode 后端服务。

## 架构

- `sdks/tncode/src`：扩展代码。
- `sdks/tncode/frontend`：tncode UI 的独立前端工作区（单一事实来源，无覆盖层）。
- 后端服务运行于 opencode（`packages/opencode`），并应保持与上游更新兼容。

## 功能

- 完整聊天在编辑器区域打开（`OpenCode: Open opencode`）。
- 在活动栏提供侧边栏入口以便快速操作。
- 自动启动并自动连接本地 source 服务。
- 独立前端 URL 默认值：`http://127.0.0.1:4444`。
- 文件引用快捷键（`Cmd+Alt+K` / `Ctrl+Alt+K`）会复制 `@file#Lx-Ly`。

## 服务模式

- `opencode.server.mode = auto`（默认）：先连接，若缺失则启动本地 source 服务。
- `opencode.server.mode = external`：仅连接到 `opencode.server.url`。
- `opencode.server.mode = manual`：不自动启动，由用户手动启动服务。

推荐的后端默认配置：

- `opencode.server.mode`：`auto`
- `opencode.server.url`：`http://127.0.0.1:4096`
- `opencode.server.autoStart`：`true`
- `opencode.server.sourceRepoPath`：你克隆的 `opencode` 仓库绝对路径

## 前端工作流

默认采用零拷贝模式。你只需要在 `sdks/tncode/frontend` 中开发和维护代码。

首次初始化：

```bash
cd sdks/tncode
bun install --cwd frontend
```

日常前端开发：

```bash
cd sdks/tncode
bun run frontend:dev
```

## 上游更新策略

- UI 在 `tncode/frontend` 中完全独立。
- 后端持续跟进 opencode 更新。
- 不要将上游前端文件自动同步到 tncode。
- 遇到后端兼容性问题时，优先调整 API 边界代码，而不是重写页面 UI。

## 后端兼容性测试

在 opencode 后端升级后运行以下检查：

```bash
cd sdks/tncode/frontend/packages/app
bun test --preload ./happydom.ts ./src/utils/backend-compat.test.ts
bun test --preload ./happydom.ts ./src/context/global-sync.test.ts
bun test --preload ./happydom.ts ./src/context/backend-compat.integration.test.ts
bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts
```

覆盖目标：

- 响应结构容错（`data` 缺失/null/array/object 的回退）
- 根会话加载回退行为
- 全局同步引导稳定性

## 键位绑定

- `Cmd/Ctrl+Esc`：打开 OpenCode
- `Cmd/Ctrl+Shift+Esc`：在新的编辑器标签页中打开 OpenCode
- `Cmd/Ctrl+Alt+K`：复制当前文件引用

## 扩展开发

```bash
cd sdks/tncode
bun install
bun run check-types
bun run compile
```

在 VS Code 中打开 `sdks/tncode` 后，按 `F5` 启动扩展宿主。
