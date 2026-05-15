import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AppDatabase } from '../db.js'
import { FALLBACK_IMAGE_MODELS, getImageGenKey, getImageGenModel } from './settings.js'

const REQUEST_TIMEOUT_MS = 60_000

export class ImageGenNotConfiguredError extends Error {
  readonly code = 'IMAGE_GEN_NOT_CONFIGURED'
  constructor() {
    super('Image gen API key 未設定，請到 Settings → image-gen 填入 key。')
    this.name = 'ImageGenNotConfiguredError'
  }
}

export class ImageGenFailedError extends Error {
  readonly code = 'IMAGE_GEN_FAILED'
  constructor(message: string) {
    super(message)
    this.name = 'ImageGenFailedError'
  }
}

export type GeneratedImage = {
  relativePath: string
  absolutePath: string
  mimeType: string
  model: string
}

type GeminiInlineData = { inline_data?: { mime_type?: string; data?: string }; inlineData?: { mimeType?: string; data?: string } }
type GeminiCandidatePart = { text?: string } & GeminiInlineData
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiCandidatePart[] } }>
  error?: { message?: string }
}

function isModelNotFoundError(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('not found') ||
    lower.includes(' 404') ||
    lower.includes('not supported') ||
    lower.includes('invalid model')
  )
}

async function callGeminiImageOnce(apiKey: string, modelName: string, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    throw new ImageGenFailedError(`Gemini image API 連線失敗：${error instanceof Error ? error.message : 'unknown'}`)
  }

  const text = await response.text()
  let parsed: GeminiResponse
  try {
    parsed = JSON.parse(text) as GeminiResponse
  } catch {
    throw new ImageGenFailedError(`Gemini image API 回傳非 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`)
  }

  if (!response.ok) {
    const msg = parsed.error?.message ?? `HTTP ${response.status}`
    throw new ImageGenFailedError(`Gemini image API 失敗：${msg}`)
  }

  const parts = parsed.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((part) => (part.inline_data?.data || part.inlineData?.data))
  const data = imagePart?.inline_data?.data ?? imagePart?.inlineData?.data
  const mimeType = imagePart?.inline_data?.mime_type ?? imagePart?.inlineData?.mimeType ?? 'image/png'
  if (!data) throw new ImageGenFailedError('Gemini image API 沒有回傳圖片內容。')

  const buffer = Buffer.from(data, 'base64')
  if (buffer.length < 64) throw new ImageGenFailedError(`Gemini image API 回傳資料過小（${buffer.length} bytes）。`)

  return { buffer, mimeType }
}

export async function generateImageForDraft(db: AppDatabase, draftId: string, prompt: string, dataDir?: string): Promise<GeneratedImage> {
  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) throw new ImageGenFailedError('imagePrompt 為空，無法生圖。')

  const apiKey = getImageGenKey(db)
  if (!apiKey) throw new ImageGenNotConfiguredError()
  const primary = getImageGenModel(db)

  // Try primary, then fall through fallbacks if the model itself is the problem.
  // Other errors (quota, auth) propagate immediately.
  const candidates = [primary, ...FALLBACK_IMAGE_MODELS.filter((m) => m !== primary)]
  let lastError: ImageGenFailedError | null = null
  let success: { buffer: Buffer; mimeType: string; model: string } | null = null
  for (const modelName of candidates) {
    try {
      const out = await callGeminiImageOnce(apiKey, modelName, trimmedPrompt)
      success = { ...out, model: modelName }
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isModelNotFoundError(message) && modelName !== candidates[candidates.length - 1]) {
        lastError = error instanceof ImageGenFailedError ? error : new ImageGenFailedError(message)
        continue
      }
      throw error
    }
  }
  if (!success) {
    throw lastError ?? new ImageGenFailedError('所有 image-gen 模型都無法使用。')
  }

  const ext = success.mimeType.endsWith('jpeg') ? 'jpg' : success.mimeType.endsWith('webp') ? 'webp' : 'png'
  const baseDir = dataDir ?? resolve(process.cwd(), 'data')
  const dir = resolve(baseDir, 'post-images')
  await mkdir(dir, { recursive: true })
  const relativePath = `post-images/${draftId}.${ext}`
  const absolutePath = resolve(dir, `${draftId}.${ext}`)
  await writeFile(absolutePath, success.buffer)

  return { relativePath, absolutePath, mimeType: success.mimeType, model: success.model }
}
