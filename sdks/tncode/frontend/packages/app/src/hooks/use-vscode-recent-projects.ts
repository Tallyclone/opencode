import { createSignal, createEffect, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createVSCodeContext } from "@/hooks/use-vscode"

interface VSCodeRecentProject {
  directory: string
  name: string
  lastOpened?: number
}

export function createVSCodeRecentProjects() {
  const vscode = createVSCodeContext()

  const [projects, setProjects] = createStore<VSCodeRecentProject[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [retryCount, setRetryCount] = createSignal(0)

  const isAvailable = createMemo(() => vscode.isVSCode)

  onMount(() => {
    if (!vscode.isVSCode) {
      console.log("[VSCode Recent Projects] Not in VS Code environment, skipping")
      return
    }

    console.log("[VSCode Recent Projects] Setting up message handlers")

    vscode.onMessage("recentProjects", (data) => {
      console.log("[VSCode Recent Projects] Received recentProjects:", data)
      if (Array.isArray(data)) {
        const mapped = data.map((dir: string) => ({
          directory: dir,
          name: dir.split(/[/\\]/).pop() || dir,
        }))
        setProjects(mapped)
        setLoaded(true)
        setRetryCount(0)
      }
    })

    // Try to get recent projects immediately
    console.log("[VSCode Recent Projects] Requesting recent projects...")
    vscode.postMessage("getRecentProjects")

    // Retry a few times if not loaded
    const maxRetries = 5
    const retryInterval = setInterval(() => {
      if (loaded()) {
        clearInterval(retryInterval)
        return
      }

      if (retryCount() >= maxRetries) {
        console.log("[VSCode Recent Projects] Max retries reached")
        clearInterval(retryInterval)
        return
      }

      console.log(`[VSCode Recent Projects] Retry ${retryCount() + 1}/${maxRetries}`)
      setRetryCount((c) => c + 1)
      vscode.postMessage("getRecentProjects")
    }, 500)
  })

  function refresh() {
    if (!vscode.isVSCode) return
    console.log("[VSCode Recent Projects] Refreshing...")
    setLoaded(false)
    setRetryCount(0)
    vscode.postMessage("getRecentProjects")
  }

  function add(directory: string) {
    if (!vscode.isVSCode) return
    console.log("[VSCode Recent Projects] Adding project:", directory)
    vscode.postMessage("addRecentProject", { directory })
  }

  function open(directory: string) {
    if (!vscode.isVSCode) return
    console.log("[VSCode Recent Projects] Opening project:", directory)
    vscode.postMessage("openRecentProject", { directory })
  }

  return {
    projects: () => projects,
    loaded,
    isAvailable,
    retryCount,
    refresh,
    add,
    open,
  }
}
