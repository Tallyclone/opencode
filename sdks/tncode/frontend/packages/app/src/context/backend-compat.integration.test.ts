import { describe, expect, test } from "bun:test"
import { loadRootSessionsWithFallback } from "./global-sync/session-load"

describe("backend compatibility integration", () => {
  test("falls back when roots+limit query is unsupported", async () => {
    let count = 0
    const result = await loadRootSessionsWithFallback({
      directory: "demo",
      limit: 50,
      list: async () => {
        count += 1
        if (count === 1) {
          throw new Error("unsupported query")
        }
        return { data: [{ id: "s-1", parentID: undefined } as any] }
      },
    })

    expect(count).toBe(2)
    expect(result.limited).toBe(false)
    expect(result.data?.[0]?.id).toBe("s-1")
  })

  test("uses first response when query is supported", async () => {
    let count = 0
    const result = await loadRootSessionsWithFallback({
      directory: "demo",
      limit: 50,
      list: async () => {
        count += 1
        return { data: [{ id: "s-2", parentID: undefined } as any] }
      },
    })

    expect(count).toBe(1)
    expect(result.limited).toBe(true)
    expect(result.data?.[0]?.id).toBe("s-2")
  })
})
