import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as vscode from "vscode"
import { chooseWorkspaceDirectory, type WorkspacePick } from "./workspace"

type ServerMode = "auto" | "external" | "manual"
type ServiceState = "stopped" | "starting" | "running" | "error"

type Snapshot = {
  state: ServiceState
  url: string
  error?: string
}

type WorkspaceItem = {
  label: string
  directory: string
  openedAt: number
}

type AppConfig = {
  url: string
  autoStart: boolean
  command: string
  args: string[]
  startTimeoutMs: number
  sourceRepoPath: string
}

const OPEN_CHAT = "opencode.openChat"
const OPEN_NEW_CHAT = "opencode.openNewChat"
const ADD_FILE_REF = "opencode.addFileReference"
const RESTART_SERVER = "opencode.restartServer"
const LEGACY_OPEN = "opencode.openTerminal"
const LEGACY_OPEN_NEW = "opencode.openNewTerminal"
const LEGACY_ADD_REF = "opencode.addFilepathToTerminal"

const DEFAULT_SERVER_URL = "http://127.0.0.1:4096"
const DEFAULT_SERVER_ARGS = [
  "run",
  "--conditions=browser",
  "./src/index.ts",
  "serve",
  "--hostname",
  "127.0.0.1",
  "--port",
  "4096",
]

const KEY_REFS = "opencode.refs"
const KEY_WORKSPACES = "opencode.workspaces"

function resolveRepoRoot(sourceRepoPath: string) {
  const base = sourceRepoPath.trim() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""
  if (!base) {
    return ""
  }
  const first = fs.existsSync(base) ? fs.realpathSync(base) : base
  const chain: string[] = []
  let cur = first
  for (let i = 0; i < 8; i++) {
    chain.push(cur)
    const parent = path.dirname(cur)
    if (!parent || parent === cur) {
      break
    }
    cur = parent
  }
  for (const candidate of chain) {
    const src = path.join(candidate, "packages", "opencode", "src", "index.ts")
    if (fs.existsSync(src)) {
      return candidate
    }
  }
  return ""
}

class AppController implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | undefined
  private readonly output = vscode.window.createOutputChannel("tncode App")

  constructor(private readonly extensionPath: string) {}

  private config(): AppConfig {
    const cfg = vscode.workspace.getConfiguration("opencode")
    return {
      url: cfg.get<string>("app.url", "").trim(),
      autoStart: cfg.get<boolean>("app.autoStart", true),
      command: cfg.get<string>("app.command", "bun"),
      args: cfg.get<string[]>("app.args", ["dev", "--", "--port", "4444"]),
      startTimeoutMs: cfg.get<number>("app.startTimeoutMs", 20000),
      sourceRepoPath: cfg.get<string>("app.sourceRepoPath", "").trim(),
    }
  }

  private isLocal(url: string) {
    try {
      const host = new URL(url).hostname
      return host === "127.0.0.1" || host === "localhost"
    } catch {
      return false
    }
  }

  private async alive(url: string) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1200)
    try {
      const res = await fetch(url, { method: "GET", signal: ctrl.signal })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private resolveCommand(command: string) {
    if (process.platform !== "win32") {
      return command
    }
    if (command !== "bun") {
      return command
    }
    const envPath = process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin", "bun.exe") : ""
    if (envPath && fs.existsSync(envPath)) {
      return envPath
    }
    const homePath = path.join(os.homedir(), ".bun", "bin", "bun.exe")
    if (fs.existsSync(homePath)) {
      return homePath
    }
    return command
  }

  private resolveFrontendCwd() {
    const cwd = path.join(this.extensionPath, "frontend", "packages", "app")
    if (!fs.existsSync(path.join(cwd, "package.json"))) {
      return ""
    }
    return cwd
  }

  async resolve(baseServerUrl: string) {
    const config = this.config()
    if (!config.url) {
      return new URL("/app", baseServerUrl).toString()
    }
    if (await this.alive(config.url)) {
      return config.url
    }
    if (!config.autoStart || !this.isLocal(config.url)) {
      throw new Error(`App URL is not reachable: ${config.url}`)
    }

    const frontendCwd = this.resolveFrontendCwd()
    const repo = resolveRepoRoot(
      config.sourceRepoPath || vscode.workspace.getConfiguration("opencode").get<string>("server.sourceRepoPath", ""),
    )
    const cwd = frontendCwd || (repo ? path.join(repo, "packages", "app") : "")
    if (!cwd) {
      throw new Error(
        "Cannot resolve app path. Ensure sdks/tncode/frontend/packages/app exists or set opencode.app.sourceRepoPath.",
      )
    }
    if (!fs.existsSync(cwd)) {
      throw new Error(`App source path does not exist: ${cwd}`)
    }

    if (!this.proc || this.proc.killed) {
      const command = this.resolveCommand(config.command)
      this.output.appendLine(`Starting app in ${cwd}`)
      this.output.appendLine(`> ${command} ${config.args.join(" ")}`)
      this.proc = spawn(command, config.args, {
        cwd,
        env: { ...process.env, OPENCODE_CALLER: "vscode" },
        stdio: "pipe",
        shell: process.platform === "win32",
      })
      this.proc.stdout.on("data", (chunk: Buffer) => this.output.append(chunk.toString()))
      this.proc.stderr.on("data", (chunk: Buffer) => this.output.append(chunk.toString()))
      this.proc.on("exit", (code, signal) => {
        this.output.appendLine(`App exited (code=${code}, signal=${signal})`)
        this.proc = undefined
      })
    }

    const start = Date.now()
    while (Date.now() - start < config.startTimeoutMs) {
      if (await this.alive(config.url)) {
        return config.url
      }
      await sleep(250)
    }

    throw new Error(`App did not become healthy within ${config.startTimeoutMs}ms: ${config.url}`)
  }

  dispose() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill()
    }
    this.proc = undefined
    this.output.dispose()
  }
}

class ServiceController implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | undefined
  private readonly output: vscode.OutputChannel
  private readonly status: vscode.StatusBarItem
  private state: ServiceState = "stopped"
  private url: string
  private error: string | undefined
  private lastSpawnError: string | undefined
  private preloadError = false
  private readonly listeners = new Set<() => void>()

  constructor() {
    this.output = vscode.window.createOutputChannel("tncode")
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.status.command = OPEN_CHAT
    this.status.tooltip = "Open tncode"
    this.status.show()
    this.url = this.getConfig().url
    this.renderStatus()
  }

  private getConfig() {
    const cfg = vscode.workspace.getConfiguration("opencode")
    return {
      mode: cfg.get<ServerMode>("server.mode", "auto"),
      url: cfg.get<string>("server.url", DEFAULT_SERVER_URL),
      autoStart: cfg.get<boolean>("server.autoStart", true),
      sourceRepoPath: cfg.get<string>("server.sourceRepoPath", ""),
      command: cfg.get<string>("server.command", "bun"),
      args: cfg.get<string[]>("server.args", DEFAULT_SERVER_ARGS),
      startTimeoutMs: cfg.get<number>("server.startTimeoutMs", 20000),
    }
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return {
      dispose: () => {
        this.listeners.delete(cb)
      },
    }
  }

  snapshot(): Snapshot {
    return { state: this.state, url: this.url, error: this.error }
  }

  showLogs() {
    this.output.show(true)
  }

  private notify() {
    for (const cb of this.listeners) {
      cb()
    }
  }

  private setState(state: ServiceState, error?: string) {
    this.state = state
    this.error = error
    this.renderStatus()
    this.notify()
  }

  private renderStatus() {
    const icon =
      this.state === "running"
        ? "$(radio-tower)"
        : this.state === "starting"
          ? "$(sync~spin)"
          : this.state === "error"
            ? "$(warning)"
            : "$(circle-outline)"
    const label =
      this.state === "running"
        ? "tncode"
        : this.state === "starting"
          ? "tncode starting"
          : this.state === "error"
            ? "tncode error"
            : "tncode offline"
    this.status.text = `${icon} ${label}`
  }

  private repoPath(config: ReturnType<ServiceController["getConfig"]>) {
    if (config.sourceRepoPath.trim()) {
      return config.sourceRepoPath.trim()
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""
  }

  private findRepoRoot(start: string) {
    return resolveRepoRoot(start)
  }

  private resolveCwd(config: ReturnType<ServiceController["getConfig"]>) {
    const base = this.repoPath(config)
    if (!base) {
      return ""
    }
    const repo = this.findRepoRoot(base)
    if (!repo) {
      return ""
    }
    return path.join(repo, "packages", "opencode")
  }

  private async alive(url: string) {
    const eventURL = new URL("/event", url).toString()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1200)
    try {
      const res = await fetch(eventURL, { method: "GET", signal: ctrl.signal })
      return res.status === 200
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private parseListeningLine(line: string) {
    const match = line.match(/opencode server listening on\s+(https?:\/\/\S+)/i)
    if (!match?.[1]) {
      return
    }
    this.url = match[1]
    this.notify()
  }

  async ensureRunning() {
    const config = this.getConfig()
    this.url = config.url

    if (await this.alive(this.url)) {
      this.setState("running")
      return this.url
    }

    if (config.mode === "manual") {
      this.setState("stopped", `tncode server is not running at ${this.url}`)
      throw new Error(`tncode server is not running at ${this.url}`)
    }

    if (config.mode === "external") {
      this.setState("error", `Could not connect to external server ${this.url}`)
      throw new Error(`Could not connect to external server ${this.url}`)
    }

    if (!config.autoStart) {
      this.setState("stopped", `tncode server is not running at ${this.url}`)
      throw new Error(`tncode server is not running at ${this.url}`)
    }

    await this.start(config)
    return this.url
  }

  private async start(config: ReturnType<ServiceController["getConfig"]>) {
    if (this.proc && !this.proc.killed) {
      if (await this.alive(this.url)) {
        this.setState("running")
        return
      }
      this.proc.kill()
      this.proc = undefined
    }

    const cwd = this.resolveCwd(config)
    if (!cwd) {
      throw new Error(
        "Cannot resolve source repository path. Set the tncode server sourceRepoPath to your cloned tncode repo root.",
      )
    }
    if (!fs.existsSync(cwd)) {
      throw new Error(`Source path does not exist: ${cwd}`)
    }

    this.setState("starting")
    this.lastSpawnError = undefined
    this.preloadError = false
    this.output.appendLine(`Starting tncode server in ${cwd}`)
    const command = this.resolveCommand(config.command)
    this.output.appendLine(`> ${command} ${config.args.join(" ")}`)

    this.proc = spawn(command, config.args, {
      cwd,
      env: {
        ...process.env,
        OPENCODE_CALLER: "vscode",
      },
      stdio: "pipe",
      shell: process.platform === "win32",
    })

    this.proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      this.output.append(text)
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
          continue
        }
        this.parseListeningLine(line)
      }
    })

    this.proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      this.output.append(text)
      if (text.includes('ENOENT resolving preload "@opentui/solid/preload"')) {
        this.preloadError = true
      }
    })

    this.proc.on("error", (error) => {
      this.lastSpawnError = error instanceof Error ? error.message : String(error)
      this.output.appendLine(`tncode server failed to spawn: ${this.lastSpawnError}`)
      this.proc = undefined
      this.setState("error", this.lastSpawnError)
    })

    this.proc.on("exit", (code, signal) => {
      this.output.appendLine(`tncode server exited (code=${code}, signal=${signal})`)
      this.proc = undefined
      this.setState(code === 0 ? "stopped" : "error", code === 0 ? undefined : `Server exited (${signal ?? code})`)
    })

    const start = Date.now()
    while (Date.now() - start < config.startTimeoutMs) {
      if (this.lastSpawnError) {
        throw new Error(`Failed to start tncode server: ${this.lastSpawnError}`)
      }
      if (!this.proc) {
        if (this.preloadError) {
          throw new Error(
            "tncode dependencies are missing. Run 'bun install' at the tncode repo root, then restart extension host.",
          )
        }
        throw new Error("tncode server exited before becoming healthy. Check tncode output channel.")
      }
      if (await this.alive(this.url)) {
        this.setState("running")
        return
      }
      await sleep(250)
    }

    this.setState("error", `tncode server did not become healthy within ${config.startTimeoutMs}ms`)
    throw new Error(`tncode server did not become healthy within ${config.startTimeoutMs}ms. Check tncode output.`)
  }

  private resolveCommand(command: string) {
    if (process.platform !== "win32") {
      return command
    }
    if (command !== "bun") {
      return command
    }
    const envPath = process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin", "bun.exe") : ""
    if (envPath && fs.existsSync(envPath)) {
      return envPath
    }
    const homePath = path.join(os.homedir(), ".bun", "bin", "bun.exe")
    if (fs.existsSync(homePath)) {
      return homePath
    }
    return command
  }

  async restart() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill()
      this.proc = undefined
      await sleep(120)
    }
    const config = this.getConfig()
    this.url = config.url
    await this.start(config)
  }

  dispose() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill()
    }
    this.proc = undefined
    this.status.dispose()
    this.output.dispose()
  }
}

class SidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "opencode.chatSidebar"
  private view: vscode.WebviewView | undefined

  constructor(
    private readonly service: ServiceController,
    private readonly openChat: () => Promise<void>,
    private readonly openNewChat: () => Promise<void>,
    private readonly openWorkspace: (directory: string) => Promise<void>,
    private readonly closeAllChats: () => Promise<void>,
    private readonly restartServer: () => Promise<void>,
    private readonly copyRef: () => Promise<void>,
    private readonly insertRef: (ref: string) => Promise<void>,
    private readonly getRefs: () => string[],
    private readonly getWorkspaces: () => WorkspaceItem[],
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = this.html()
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "open") {
        await this.openChat()
      }
      if (msg?.type === "new") {
        await this.openNewChat()
      }
      if (msg?.type === "closeAll") {
        await this.closeAllChats()
      }
      if (msg?.type === "restart") {
        await this.restartServer()
      }
      if (msg?.type === "insertRef") {
        await this.copyRef()
      }
      if (msg?.type === "ref") {
        if (typeof msg.ref === "string" && msg.ref.trim()) {
          await this.insertRef(msg.ref)
        }
      }
      if (msg?.type === "logs") {
        this.service.showLogs()
      }
      if (msg?.type === "workspace") {
        if (typeof msg.directory === "string" && msg.directory.trim()) {
          await this.openWorkspace(msg.directory)
        }
      }
    })
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        return
      }
      this.refresh()
    })
    this.refresh()
  }

  refresh() {
    if (!this.view) {
      return
    }
    this.view.webview.postMessage({
      type: "state",
      payload: {
        service: this.service.snapshot(),
        refs: this.getRefs(),
        workspaces: this.getWorkspaces(),
      },
    })
  }

  private html() {
    const nonce = String(Date.now())
    return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; }
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); overflow-x: hidden; }
    .wrap { width: 100%; max-width: 251px; margin: 0 auto; padding: 10px; display: grid; gap: 8px; }
    .hero { border: 1px solid color-mix(in srgb, var(--vscode-foreground) 14%, transparent); border-radius: 10px; padding: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 74%, transparent); }
    .title { font-size: 12px; font-weight: 700; letter-spacing: .2px; }
    .sub { margin-top: 4px; opacity: .76; font-size: 11px; }
    .grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
    button { border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent); background: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent); color: var(--vscode-foreground); border-radius: 8px; padding: 6px 8px; font-size: 11px; cursor: pointer; }
    button:hover { background: color-mix(in srgb, var(--vscode-list-hoverBackground) 80%, transparent); }
    button.secondary { background: transparent; border-color: color-mix(in srgb, var(--vscode-foreground) 20%, transparent); color: var(--vscode-foreground); }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 30px; padding: 0; background: transparent; font-size: 18px; line-height: 1; }
    .card { border: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent); border-radius: 10px; padding: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 74%, transparent); }
    .h { font-size: 11px; font-weight: 700; opacity: .9; margin-bottom: 8px; letter-spacing: .2px; }
    .status { display:flex; gap:8px; align-items: center; font-size: 11px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .list { display: grid; gap: 6px; }
    .item { border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent); border-radius: 8px; padding: 7px; font-size: 11px; background: color-mix(in srgb, var(--vscode-editor-background) 82%, transparent); }
    .mono { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="title">任务中枢</div>
      <div class="grid">
        <button id="open" class="icon-btn" title="打开tncode" aria-label="打开tncode">◉</button>
        <button id="new" class="icon-btn" title="新建tncode" aria-label="新建tncode">⊕</button>
        <button id="copy" class="icon-btn" title="添加当前文件到上下文" aria-label="添加当前文件到上下文">⧉</button>
        <button id="closeAll" class="icon-btn" title="关闭所有tncode" aria-label="关闭所有tncode">✕</button>
        <button id="restart" class="icon-btn" title="重启服务" aria-label="重启服务">↻</button>
      </div>
    </div>

    <div class="card">
      <div class="h">连接状态</div>
      <div class="status"><span id="dot" class="dot"></span><span id="statusText"></span></div>
      <div id="url" class="sub mono" style="margin-top:6px"></div>
      <div id="err" class="sub" style="color:var(--vscode-errorForeground)"></div>
      <div style="margin-top:8px"><button id="logs" class="secondary">打开日志</button></div>
    </div>

    <div class="card">
      <div class="h">会话导航</div>
      <div id="workspaces" class="list"></div>
    </div>

    <div class="card">
      <div class="h">固定上下文</div>
      <div id="refs" class="list"></div>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const byId = (id) => document.getElementById(id);
    byId('open')?.addEventListener('click', () => vscode.postMessage({ type: 'open' }));
    byId('new')?.addEventListener('click', () => vscode.postMessage({ type: 'new' }));
    byId('copy')?.addEventListener('click', () => vscode.postMessage({ type: 'insertRef' }));
    byId('closeAll')?.addEventListener('click', () => vscode.postMessage({ type: 'closeAll' }));
    byId('restart')?.addEventListener('click', () => vscode.postMessage({ type: 'restart' }));
    byId('logs')?.addEventListener('click', () => vscode.postMessage({ type: 'logs' }));
    const stateColor = (s) => s === 'running' ? '#3fb950' : s === 'starting' ? '#d29922' : s === 'error' ? '#f85149' : '#8b949e';
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'state') return;
      const data = event.data.payload;
      byId('dot').style.background = stateColor(data.service.state);
      byId('statusText').textContent = data.service.state.toUpperCase();
      byId('url').textContent = data.service.url || '';
      byId('err').textContent = data.service.error || '';

      const refs = byId('refs');
      refs.innerHTML = '';
      for (const ref of (data.refs || []).slice(0, 6)) {
        const row = document.createElement('button');
        row.className = 'item mono secondary';
        row.textContent = ref;
        row.title = '引用到聊天输入框';
        row.addEventListener('click', () => vscode.postMessage({ type: 'ref', ref }));
        refs.appendChild(row);
      }
      if (!refs.children.length) {
        const row = document.createElement('div');
        row.className = 'item';
        row.textContent = '暂无上下文，请使用上方按钮添加当前文件。';
        refs.appendChild(row);
      }

      const workspaces = byId('workspaces');
      workspaces.innerHTML = '';
      for (const s of (data.workspaces || []).slice(0, 5)) {
        const row = document.createElement('button');
        row.className = 'secondary';
        row.style.textAlign = 'left';
        row.textContent = s.label;
        row.title = s.directory;
        row.addEventListener('click', () => vscode.postMessage({ type: 'workspace', directory: s.directory }));
        workspaces.appendChild(row);
      }
      if (!workspaces.children.length) {
        const row = document.createElement('div');
        row.className = 'item';
        row.textContent = '暂无会话历史。';
        workspaces.appendChild(row);
      }
    });
  </script>
</body>
</html>`
  }
}

let panel: vscode.WebviewPanel | undefined
const chatPanels = new Set<vscode.WebviewPanel>()

export function activate(context: vscode.ExtensionContext) {
  const service = new ServiceController()
  const app = new AppController(context.extensionPath)

  const refs = context.workspaceState.get<string[]>(KEY_REFS, [])
  const workspaceLocal = context.workspaceState.get<WorkspaceItem[]>(KEY_WORKSPACES, [])
  const workspaceGlobal = context.globalState.get<WorkspaceItem[]>(KEY_WORKSPACES, [])
  const workspaces = [...workspaceLocal, ...workspaceGlobal]
    .filter((item, index, all) => all.findIndex((x) => x.directory === item.directory) === index)
    .slice(0, 20)

  const pushRef = async (ref: string) => {
    const next = [ref, ...refs.filter((x) => x !== ref)].slice(0, 20)
    refs.splice(0, refs.length, ...next)
    await context.workspaceState.update(KEY_REFS, refs)
    sidebar.refresh()
  }

  const pushWorkspace = async (directory?: string) => {
    const folders = vscode.workspace.workspaceFolders ?? []
    const target = directory ?? currentWorkspaceDirectory()
    if (!target) {
      return
    }
    const folder = folders.find((f) => f.uri.fsPath === target)
    const label = folder?.name ?? path.basename(target)
    const item: WorkspaceItem = { label, directory: target, openedAt: Date.now() }
    const next = [item, ...workspaces.filter((x) => x.directory !== item.directory)].slice(0, 20)
    workspaces.splice(0, workspaces.length, ...next)
    await context.globalState.update(KEY_WORKSPACES, workspaces)
    sidebar.refresh()
  }

  const open = async (forceNew: boolean, workspaceDirectory?: string) => {
    const target = workspaceDirectory ?? currentWorkspaceDirectory()
    await openChat(context, service, app, forceNew, target)
    await pushWorkspace(target)
  }

  const closeAllChats = async () => {
    for (const p of [...chatPanels]) {
      p.dispose()
    }
    panel = undefined
  }

  const broadcastInsertRef = (ref: string) => {
    for (const p of chatPanels) {
      p.webview.postMessage({ type: "insertRef", ref })
    }
  }

  const insertRef = async (ref: string) => {
    await pushRef(ref)
    await open(false)
    broadcastInsertRef(ref)
  }

  const openWorkspace = async (directory: string) => {
    await pushWorkspace(directory)
    await open(false, directory)
  }

  const syncWorkspace = async () => {
    await pushWorkspace(currentWorkspaceDirectory())
    if (!panel) {
      return
    }
    try {
      const appURL = await app.resolve(service.snapshot().url)
      panel.webview.html = panelHtml(appURL, currentWorkspaceDirectory())
    } catch {
      // ignore workspace sync failures; existing panel remains usable
    }
  }

  const copyRef = async () => {
    const fileRef = getActiveFileRef()
    if (!fileRef) {
      vscode.window.showWarningMessage("No active file in workspace")
      return
    }
    await vscode.env.clipboard.writeText(fileRef)
    await pushRef(fileRef)
    vscode.window.showInformationMessage(`Copied ${fileRef}`)
    if (panel) panel.webview.postMessage({ type: "hint", text: "已添加到固定上下文，并引用到聊天输入框。" })
    broadcastInsertRef(fileRef)
  }

  const restart = async () => {
    try {
      await service.restart()
      if (panel) {
        const appURL = await app.resolve(service.snapshot().url)
        panel.webview.html = panelHtml(appURL, currentWorkspaceDirectory())
      }
      vscode.window.showInformationMessage("tncode server restarted")
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const sidebar = new SidebarViewProvider(
    service,
    async () => open(false),
    async () => open(true),
    openWorkspace,
    closeAllChats,
    restart,
    copyRef,
    insertRef,
    () => refs,
    () => workspaces,
  )

  context.subscriptions.push(
    service,
    app,
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebar),
    service.subscribe(() => sidebar.refresh()),
    vscode.commands.registerCommand(OPEN_CHAT, async () => open(false)),
    vscode.commands.registerCommand(OPEN_NEW_CHAT, async () => open(true)),
    vscode.commands.registerCommand(ADD_FILE_REF, copyRef),
    vscode.commands.registerCommand(RESTART_SERVER, restart),
    vscode.commands.registerCommand(LEGACY_OPEN, async () => open(false)),
    vscode.commands.registerCommand(LEGACY_OPEN_NEW, async () => open(true)),
    vscode.commands.registerCommand(LEGACY_ADD_REF, copyRef),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void syncWorkspace()
    }),
  )

  void syncWorkspace()

  const cfg = vscode.workspace.getConfiguration("opencode")
  const shouldWarm = cfg.get<ServerMode>("server.mode", "auto") === "auto" && cfg.get<boolean>("server.autoStart", true)
  if (shouldWarm) {
    void service.ensureRunning().catch(() => undefined)
    void service
      .ensureRunning()
      .then((url) => app.resolve(url))
      .catch(() => undefined)
  }
}

async function openChat(
  context: vscode.ExtensionContext,
  service: ServiceController,
  app: AppController,
  forceNew: boolean,
  workspaceDirectory?: string,
) {
  if (!forceNew && panel) {
    if (workspaceDirectory) {
      try {
        const serverURL = await service.ensureRunning()
        const appURL = await app.resolve(serverURL)
        panel.webview.html = panelHtml(appURL, workspaceDirectory)
      } catch {}
    }
    panel.reveal(vscode.ViewColumn.Beside, false)
    return
  }

  const next = vscode.window.createWebviewPanel("opencode.chat", "tncode", vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  })
  panel = next
  chatPanels.add(next)

  next.onDidDispose(() => {
    chatPanels.delete(next)
    if (panel === next) {
      panel = undefined
    }
  })

  next.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type !== "restart") {
      return
    }
    await vscode.commands.executeCommand(RESTART_SERVER)
  })

  next.webview.html = loadingHtml()
  try {
    const serverURL = await service.ensureRunning()
    const appURL = await app.resolve(serverURL)
    next.webview.html = panelHtml(appURL, workspaceDirectory ?? currentWorkspaceDirectory())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    next.webview.html = errorHtml(message)
    vscode.window.showErrorMessage(message)
  }

  context.subscriptions.push(next)
}

function loadingHtml() {
  return '<!doctype html><html><body style="font-family: var(--vscode-font-family); padding:16px;">Starting tncode...</body></html>'
}

function errorHtml(message: string) {
  return `<!doctype html><html><body style="font-family: var(--vscode-font-family); padding:16px;"><h3>tncode failed to start</h3><pre>${escapeHtml(message)}</pre></body></html>`
}

function panelHtml(url: string, workspaceDirectory?: string) {
  const safeUrl = escapeHtml(withFullLayout(url, workspaceDirectory))
  const nonce = String(Date.now())
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; overflow:hidden; background: var(--vscode-editor-background);">
    <div id="hint" style="position:fixed;top:12px;right:12px;z-index:2;background:var(--vscode-notifications-background);color:var(--vscode-notifications-foreground);padding:8px 10px;border-radius:6px;display:none;"></div>
    <iframe id="opencode-iframe" title="tncode" src="${safeUrl}" style="border:0; width:100vw; height:100vh;"></iframe>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      window.addEventListener('message', (event) => {
        if (event.data?.type !== 'hint') return;
        const el = document.getElementById('hint');
        if (!el) return;
        el.textContent = event.data.text || '';
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 2200);
      });
      window.addEventListener('message', (event) => {
        if (event.data?.type !== 'insertRef') return;
        const iframe = document.getElementById('opencode-iframe');
        if (!iframe || !(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage({ type: 'opencode.insertRef', ref: event.data.ref || '' }, '*');
      });
      window.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
          event.preventDefault();
          vscode.postMessage({ type: 'restart' });
        }
      });
    </script>
  </body>
</html>`
}

function withFullLayout(url: string, workspaceDirectory?: string) {
  try {
    const next = new URL(url)
    next.searchParams.set("caller", "vscode")
    next.searchParams.set("layout", "full")
    if (workspaceDirectory && (next.hostname === "127.0.0.1" || next.hostname === "localhost")) {
      next.searchParams.set("workspace", workspaceDirectory)
    }
    return next.toString()
  } catch {
    return url
  }
}

function workspacePick() {
  return vscode.workspace.getConfiguration("opencode").get<WorkspacePick>("workspace.pick", "active")
}

function currentWorkspaceDirectory() {
  const folders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
  const active = vscode.window.activeTextEditor
  const activeFolder = active ? vscode.workspace.getWorkspaceFolder(active.document.uri)?.uri.fsPath : undefined
  return chooseWorkspaceDirectory({ pick: workspacePick(), folders, active: activeFolder })
}

function getActiveFileRef() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    return
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri)
  if (!workspaceFolder) {
    return
  }
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri)
  const ref = `@${relativePath}`
  if (editor.selection.isEmpty) {
    return ref
  }
  const startLine = editor.selection.start.line + 1
  const endLine = editor.selection.end.line + 1
  if (startLine === endLine) {
    return `${ref}#L${startLine}`
  }
  return `${ref}#L${startLine}-${endLine}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function deactivate() {}
