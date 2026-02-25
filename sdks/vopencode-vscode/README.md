# OpenCode VS Code Extension (vopencode)

OpenCode in VS Code with a rich web chat surface instead of terminal tabs.

This is the customized version of the official opencode VS Code extension.

## Features

- Full chat opens in editor area (`OpenCode: Open opencode`)
- Sidebar entry in Activity Bar for quick actions
- Auto-start and auto-connect local source server
- Source-first startup (use your cloned repo, not global npm install)
- File reference shortcut (`Cmd+Alt+K` / `Ctrl+Alt+K`) copies `@file#Lx-Ly`

## Server Modes

This extension supports three server modes via settings:

- `opencode.server.mode = auto` (default): connect first, start local source server if missing
- `opencode.server.mode = external`: connect only to `opencode.server.url`
- `opencode.server.mode = manual`: do not auto start, user starts server manually

Recommended source-first defaults:

- `opencode.server.mode`: `auto`
- `opencode.server.url`: `http://127.0.0.1:4096`
- `opencode.server.autoStart`: `true`
- `opencode.server.sourceRepoPath`: absolute path to your cloned `opencode` repo

## Keybindings

- `Cmd/Ctrl+Esc`: Open OpenCode
- `Cmd/Ctrl+Shift+Esc`: Open OpenCode in a new editor tab
- `Cmd/Ctrl+Alt+K`: Copy active file reference

## Development

1. `code sdks/vopencode-vscode`
2. `bun install`
3. Press `F5` to run Extension Development Host

Build checks:

- `bun run check-types`
- `bun run lint`
- `bun run compile`
