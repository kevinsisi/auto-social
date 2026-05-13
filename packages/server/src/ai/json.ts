import { z } from 'zod'

export function parseJsonObject<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  const trimmed = raw.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const candidates = [withoutFence, extractJsonObject(withoutFence)].filter(Boolean) as string[]
  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate))
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`${label} 回傳不是可用 JSON：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function extractJsonObject(text: string): string | null {
  const openIdx = text.indexOf('{')
  const closeIdx = text.lastIndexOf('}')
  if (openIdx < 0 || closeIdx <= openIdx) return null
  return text.slice(openIdx, closeIdx + 1)
}
