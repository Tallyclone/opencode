export type WorkspacePick = "active" | "first"

export function chooseWorkspaceDirectory(input: { pick: WorkspacePick; folders: string[]; active?: string }) {
  if (input.folders.length === 0) {
    return
  }
  if (input.pick === "first") {
    return input.folders[0]
  }
  if (input.active && input.folders.includes(input.active)) {
    return input.active
  }
  return input.folders[0]
}
