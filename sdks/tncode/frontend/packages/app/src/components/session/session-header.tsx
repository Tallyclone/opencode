import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { getFilename } from "@opencode-ai/util/path"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"
import { forceDesktopLayout } from "@/utils/layout-mode"

import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { AppIcon } from "@opencode-ai/ui/app-icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { Keybind } from "@opencode-ai/ui/keybind"
import { showToast } from "@opencode-ai/ui/toast"
import { StatusPopover } from "../status-popover"
import { useLayout } from "@/context/layout"
import { RIGHT_RAIL_WIDTH } from "@/pages/layout/dimensions"

const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

type OpenApp = (typeof OPEN_APPS)[number]
type OS = "macos" | "windows" | "linux" | "unknown"

const MAC_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "Visual Studio Code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "TextMate", icon: "textmate", openWith: "TextMate" },
  { id: "antigravity", label: "Antigravity", icon: "antigravity", openWith: "Antigravity" },
  { id: "terminal", label: "Terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "iTerm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "Ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "xcode", label: "Xcode", icon: "xcode", openWith: "Xcode" },
  { id: "android-studio", label: "Android Studio", icon: "android-studio", openWith: "Android Studio" },
  { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
] as const

const WINDOWS_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
  { id: "powershell", label: "PowerShell", icon: "powershell", openWith: "powershell" },
  { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
] as const

const LINUX_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
  { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
] as const

type OpenOption = (typeof MAC_APPS)[number] | (typeof WINDOWS_APPS)[number] | (typeof LINUX_APPS)[number]
type OpenIcon = OpenApp | "file-explorer"
const OPEN_ICON_BASE = new Set<OpenIcon>(["finder", "vscode", "cursor", "zed"])

const openIconSize = (id: OpenIcon) => (OPEN_ICON_BASE.has(id) ? "size-4" : "size-[19px]")

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

const showRequestError = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useSessionShare(args: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  currentSession: () =>
    | {
        id: string
        share?: {
          url?: string
        }
      }
    | undefined
  projectDirectory: () => string
  platform: ReturnType<typeof usePlatform>
}) {
  const [state, setState] = createStore({
    share: false,
    unshare: false,
    copied: false,
    timer: undefined as number | undefined,
  })
  const shareUrl = createMemo(() => args.currentSession()?.share?.url)

  createEffect(() => {
    const url = shareUrl()
    if (url) return
    if (state.timer) window.clearTimeout(state.timer)
    setState({ copied: false, timer: undefined })
  })

  onCleanup(() => {
    if (state.timer) window.clearTimeout(state.timer)
  })

  const shareSession = () => {
    const session = args.currentSession()
    if (!session || state.share) return
    setState("share", true)
    args.globalSDK.client.session
      .share({ sessionID: session.id, directory: args.projectDirectory() })
      .catch((error) => {
        console.error("Failed to share session", error)
      })
      .finally(() => {
        setState("share", false)
      })
  }

  const unshareSession = () => {
    const session = args.currentSession()
    if (!session || state.unshare) return
    setState("unshare", true)
    args.globalSDK.client.session
      .unshare({ sessionID: session.id, directory: args.projectDirectory() })
      .catch((error) => {
        console.error("Failed to unshare session", error)
      })
      .finally(() => {
        setState("unshare", false)
      })
  }

  const copyLink = (onError: (error: unknown) => void) => {
    const url = shareUrl()
    if (!url) return
    navigator.clipboard
      .writeText(url)
      .then(() => {
        if (state.timer) window.clearTimeout(state.timer)
        setState("copied", true)
        const timer = window.setTimeout(() => {
          setState("copied", false)
          setState("timer", undefined)
        }, 3000)
        setState("timer", timer)
      })
      .catch(onError)
  }

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    args.platform.openLink(url)
  }

  return { state, shareUrl, shareSession, unshareSession, copyLink, viewShare }
}

export function SessionHeader() {
  const fullLayout = forceDesktopLayout()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const params = useParams()
  const command = useCommand()
  const server = useServer()
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))

  const currentSession = createMemo(() => sync.data.session.find((s) => s.id === params.id))
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const showShare = createMemo(() => shareEnabled() && !!currentSession())
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))
  const rightOffset = createMemo(() => {
    if (!fullLayout) return 0
    if (view().reviewPanel.opened()) return layout.session.width() + RIGHT_RAIL_WIDTH
    if (layout.fileTree.opened()) return layout.fileTree.width() + RIGHT_RAIL_WIDTH
    return RIGHT_RAIL_WIDTH
  })
  const projectPath = createMemo(() => {
    const raw = projectDirectory().trim()
    if (!raw) return ""
    const parts = raw
      .split(/[\\/]+/)
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length === 0) return raw
    return parts.join(" › ")
  })
  const os = createMemo(() => detectOS(platform))

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({ finder: true })

  const apps = createMemo(() => {
    if (os() === "macos") return MAC_APPS
    if (os() === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })

  const fileManager = createMemo(() => {
    if (os() === "macos") return { label: "Finder", icon: "finder" as const }
    if (os() === "windows") return { label: "File Explorer", icon: "file-explorer" as const }
    return { label: "File Manager", icon: "finder" as const }
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((value) => Boolean(value))
          .catch(() => false)
          .then((ok) => {
            console.debug(`[session-header] App "${app.label}" (${app.openWith}): ${ok ? "exists" : "does not exist"}`)
            return [app.id, ok] as const
          }),
      ),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const options = createMemo(() => {
    return [
      { id: "finder", label: fileManager().label, icon: fileManager().icon },
      ...apps().filter((app) => exists[app.id]),
    ] as const
  })

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const [menu, setMenu] = createStore({ open: false })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const current = createMemo(() => options().find((o) => o.id === prefs.app) ?? options()[0])

  const openDir = (app: OpenApp) => {
    const directory = projectDirectory()
    if (!directory) return
    if (!canOpen()) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    Promise.resolve(platform.openPath?.(directory, openWith)).catch((err: unknown) => showRequestError(language, err))
  }

  const copyPath = () => {
    const directory = projectDirectory()
    if (!directory) return
    navigator.clipboard
      .writeText(directory)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: directory,
        })
      })
      .catch((err: unknown) => showRequestError(language, err))
  }

  const share = useSessionShare({
    globalSDK,
    currentSession,
    projectDirectory,
    platform,
  })

  const rightMount = createMemo(() => document.getElementById("opencode-titlebar-right"))

  return (
    <>
      <Show when={fullLayout && rightMount()}>
        {(mount) => (
          <Portal mount={mount()!}>
            <div class="session-titlebar-right" style={{ "margin-right": `${rightOffset()}px` }}>
              <Show when={projectPath()}>
                <span data-component="session-titlebar-path" class="session-titlebar-path" title={projectDirectory()}>
                  {projectPath()}
                </span>
              </Show>
              <StatusPopover />
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
