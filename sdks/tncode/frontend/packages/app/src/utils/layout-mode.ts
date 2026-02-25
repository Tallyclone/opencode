export function forceDesktopLayout() {
  if (typeof window === "undefined") return false
  const query = new URLSearchParams(window.location.search)
  if (query.get("layout") === "full" || query.get("caller") === "vscode") {
    try {
      window.sessionStorage.setItem("opencode.layout.full", "1")
    } catch {}
    return true
  }
  try {
    if (window.sessionStorage.getItem("opencode.layout.full") === "1") return true
  } catch {}
  return false
}
