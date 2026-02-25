type RecordValue = Record<string, unknown>

const isRecord = (value: unknown): value is RecordValue => {
  return typeof value === "object" && value !== null
}

export const readData = <T>(value: unknown) => {
  if (!isRecord(value)) {
    return undefined
  }
  if (!("data" in value)) {
    return undefined
  }
  const data = value.data as T | null | undefined
  if (data === null || data === undefined) {
    return undefined
  }
  return data
}

export const readList = <T>(value: unknown) => {
  const data = readData<unknown>(value)
  if (!Array.isArray(data)) {
    return [] as T[]
  }
  return data as T[]
}

export const readObject = <T extends RecordValue>(value: unknown, fallback: T) => {
  const data = readData<unknown>(value)
  if (!isRecord(data) || Array.isArray(data)) {
    return fallback
  }
  return data as T
}

export const readValue = <T>(value: unknown, fallback: T) => {
  const data = readData<T>(value)
  if (data === undefined) {
    return fallback
  }
  return data
}
