import { z } from 'zod'

export function parseJsonObject<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  const trimmed = raw.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return schema.parse(JSON.parse(withoutFence))
  } catch (error) {
    throw new Error(`${label} 回傳不是可用 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}
