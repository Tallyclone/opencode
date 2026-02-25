import { createSignal, onMount, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

interface VSCodeAPI {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare global {
  interface Window {
    acquireVsCodeApi?(): VSCodeAPI
  }
}

type MessageHandler = (data: unknown) => void

interface VSCodeContext {
  isVSCode: boolean
  api: VSCodeAPI | null
  postMessage(type: string, data?: unknown): void
  onMessage(type: string, handler: MessageHandler): () => void
}

function hasParentBridge() {
  if (typeof window === "undefined") return false
  return window.parent !== window
}

// Check if we're inside VS Code webview
// This must be called early before any other code runs
function checkVSCodeEnvironment(): VSCodeAPI | null {
  if (typeof window === "undefined") return null
  if (!window.acquireVsCodeApi) return null

  try {
    return window.acquireVsCodeApi()
  } catch {
    return null
  }
}

// Try to get VS Code API immediately
const vscodeApi = checkVSCodeEnvironment()

export function createVSCodeContext(): VSCodeContext {
  const [api] = createSignal<VSCodeAPI | null>(vscodeApi)

  const [handlers] = createStore<Record<string, MessageHandler[]>>({})

  const isVSCode = createMemo(() => api() !== null || hasParentBridge())

  function postMessage(type: string, data?: unknown) {
    const vscode = api()
    if (!vscode) {
      console.log("[VSCode] Cannot post message, not in VS Code environment")
      return
    }
    try {
      if (vscode) {
        vscode.postMessage({ type, data })
        return
      }
      if (hasParentBridge()) {
        window.parent.postMessage({ type, data }, "*")
      }
    } catch (e) {
      console.error("[VSCode] Failed to post message:", e)
    }
  }

  function onMessage(type: string, handler: MessageHandler) {
    if (!handlers[type]) {
      handlers[type] = []
    }
    handlers[type].push(handler)

    return () => {
      const index = handlers[type]?.indexOf(handler)
      if (index !== undefined && index !== -1) {
        handlers[type].splice(index, 1)
      }
    }
  }

  onMount(() => {
    if (!isVSCode()) {
      console.log("[VSCode] Not running in VS Code webview")
      return
    }

    console.log("[VSCode] Running in VS Code webview, setting up message handlers")

    const handleMessage = (event: MessageEvent) => {
      const { type, data } = event.data ?? {}
      if (!type) return

      console.log("[VSCode] Received message:", type, data)
      handlers[type]?.forEach((handler) => handler(data))
    }

    window.addEventListener("message", handleMessage)
    onCleanup(() => window.removeEventListener("message", handleMessage))
  })

  return {
    get isVSCode() {
      return isVSCode()
    },
    get api() {
      return api()
    },
    postMessage,
    onMessage,
  }
}
