import { describe, expect, test } from "bun:test"
import { readData, readList, readObject, readValue } from "./backend-compat"

describe("backend compat", () => {
  test("reads data only from response-like values", () => {
    expect(readData<string>({ data: "ok" })).toBe("ok")
    expect(readData<string>({ data: null })).toBeUndefined()
    expect(readData<string>({ value: "nope" })).toBeUndefined()
    expect(readData<string>(undefined)).toBeUndefined()
  })

  test("normalizes list payloads", () => {
    expect(readList<number>({ data: [1, 2, 3] })).toEqual([1, 2, 3])
    expect(readList<number>({ data: { id: 1 } })).toEqual([])
    expect(readList<number>({ data: null })).toEqual([])
  })

  test("normalizes object payloads", () => {
    expect(readObject({ data: { id: "x" } }, { id: "fallback" })).toEqual({ id: "x" })
    expect(readObject({ data: [] }, { id: "fallback" })).toEqual({ id: "fallback" })
  })

  test("uses fallback value when data is missing", () => {
    expect(readValue({ data: 1 }, 0)).toBe(1)
    expect(readValue({ data: null }, 0)).toBe(0)
    expect(readValue({}, 2)).toBe(2)
  })
})
