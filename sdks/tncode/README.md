# tncode VS Code Extension

Chinese version: `sdks/tncode/README.zh-CN.md`

tncode uses an independent VS Code extension and a fully independent frontend UI, while sharing opencode backend service.

## Architecture

- `sdks/tncode/src`: extension code.
- `sdks/tncode/frontend`: standalone frontend workspace for tncode UI (single source of truth, no overlay).
- backend service runs from opencode (`packages/opencode`) and should stay compatible with upstream updates.

## Features

- Full chat opens in editor area (`OpenCode: Open opencode`).
- Sidebar entry in Activity Bar for quick actions.
- Auto-start and auto-connect local source server.
- Independent frontend URL default: `http://127.0.0.1:4444`.
- File reference shortcut (`Cmd+Alt+K` / `Ctrl+Alt+K`) copies `@file#Lx-Ly`.

## Server Modes

- `opencode.server.mode = auto` (default): connect first, start local source server if missing.
- `opencode.server.mode = external`: connect only to `opencode.server.url`.
- `opencode.server.mode = manual`: do not auto start, user starts server manually.

Recommended backend defaults:

- `opencode.server.mode`: `auto`
- `opencode.server.url`: `http://127.0.0.1:4096`
- `opencode.server.autoStart`: `true`
- `opencode.server.sourceRepoPath`: absolute path to your cloned `opencode` repo

## Frontend Workflow

Zero-copy mode is the default. You only develop and maintain code in `sdks/tncode/frontend`.

Initialize once:

```bash
cd sdks/tncode
bun install --cwd frontend
```

Daily frontend development:

```bash
cd sdks/tncode
bun run frontend:dev
```

## Upstream Update Strategy

- UI is fully independent in `tncode/frontend`.
- Backend keeps following opencode updates.
- Do not auto-sync upstream frontend files into tncode.
- For backend compatibility issues, prefer adapting API boundary code instead of rewriting page UI.

## Backend Compatibility Tests

Run these checks after opencode backend upgrades:

```bash
cd sdks/tncode/frontend/packages/app
bun test --preload ./happydom.ts ./src/utils/backend-compat.test.ts
bun test --preload ./happydom.ts ./src/context/global-sync.test.ts
bun test --preload ./happydom.ts ./src/context/backend-compat.integration.test.ts
bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts
```

Coverage goals:

- response shape tolerance (`data` missing/null/array/object fallback)
- root session loading fallback behavior
- global sync bootstrap stability

## Keybindings

- `Cmd/Ctrl+Esc`: Open OpenCode
- `Cmd/Ctrl+Shift+Esc`: Open OpenCode in a new editor tab
- `Cmd/Ctrl+Alt+K`: Copy active file reference

## Extension Development

```bash
cd sdks/tncode
bun install
bun run check-types
bun run compile
```

Launch extension host with `F5` after opening `sdks/tncode` in VS Code.
