import { z } from 'zod'
import { parseJsonObject } from './json.js'
import { DEFAULT_GEMINI_MODEL } from './gemini-client.js'
import type { ImageAnalysisResult, ImageAnalyzer, SourceCandidateInput } from './types.js'
import { nowIso } from '../time.js'

const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const IMAGE_FETCH_TIMEOUT_MS = 20_000
const GEMINI_VISION_TIMEOUT_MS = 45_000
const DEFAULT_GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? DEFAULT_GEMINI_MODEL

const visionSchema = z.object({
  summary: z.string().min(1).max(500),
  images: z.array(z.object({
    imageIndex: z.number().int().min(1),
    description: z.string().min(1).max(300),
    textDetected: z.string().max(200).nullable().optional(),
    notableObjects: z.array(z.string().min(1).max(40)).max(12).optional()
  })).min(1)
})

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  error?: { message?: string }
}

type FetchedImage = {
  url: string
  originalIndex: number
  mimeType: string
  data: string
}

export function createGeminiImageAnalyzer(model = DEFAULT_GEMINI_VISION_MODEL): ImageAnalyzer {
  return async ({ candidate, imageUrls, preferredKey }) => {
    if (!preferredKey) throw new Error('image_recognition_blocked: StepRunner did not allocate a Gemini key')
    return analyzeImagesWithGemini({ candidate, imageUrls, apiKey: preferredKey, model })
  }
}

export async function analyzeImagesWithGemini(input: { candidate: SourceCandidateInput; imageUrls: string[]; apiKey: string; model?: string }): Promise<ImageAnalysisResult> {
  const model = input.model ?? DEFAULT_GEMINI_VISION_MODEL
  const urls = uniqueImageUrls(input.imageUrls).slice(0, MAX_IMAGES)
  if (urls.length === 0) return imageAnalysisNone(model)

  const fetched: FetchedImage[] = []
  const failures: string[] = []
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]!
    try {
      fetched.push(await fetchImage(url, index + 1))
    } catch (error) {
      failures.push(`圖${index + 1}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (fetched.length === 0) {
    return {
      status: 'failed',
      summary: null,
      images: [],
      error: failures.join('；') || '沒有可分析的圖片',
      model,
      analyzedAt: nowIso()
    }
  }

  const raw = await callGeminiVision(input.apiKey, model, buildVisionPrompt(input.candidate, fetched), fetched)
  const parsed = parseJsonObject(raw, visionSchema, 'image-recognition')
  const analyzedImages = parsed.images
    .map((image) => {
      const fetchedImage = fetched.find((item) => item.originalIndex === image.imageIndex)
      if (!fetchedImage) return null
      return {
        url: fetchedImage.url,
        description: image.description,
        textDetected: image.textDetected?.trim() || null,
        notableObjects: image.notableObjects ?? []
      }
    })
    .filter((image): image is NonNullable<typeof image> => image !== null)

  if (analyzedImages.length === 0) {
    return {
      status: 'failed',
      summary: null,
      images: [],
      error: 'Gemini 沒有回傳可對應的圖片描述',
      model,
      analyzedAt: nowIso()
    }
  }

  return {
    status: failures.length > 0 || analyzedImages.length < urls.length ? 'partial' : 'success',
    summary: parsed.summary,
    images: analyzedImages,
    error: failures.length > 0 ? failures.join('；') : null,
    model,
    analyzedAt: nowIso()
  }
}

export function imageAnalysisNone(model: string | null = null): ImageAnalysisResult {
  return { status: 'none', summary: null, images: [], error: null, model, analyzedAt: nowIso() }
}

export function imageAnalysisFailed(message: string, model: string | null = DEFAULT_GEMINI_VISION_MODEL): ImageAnalysisResult {
  return { status: 'failed', summary: null, images: [], error: message, model, analyzedAt: nowIso() }
}

function uniqueImageUrls(urls: string[]) {
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))]
}

async function fetchImage(url: string, originalIndex: number): Promise<FetchedImage> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('圖片 URL 格式不正確')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('圖片 URL 協定不支援')

  const response = await fetch(url, {
    headers: { 'User-Agent': 'auto-social-image-recognition/1.0' },
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`圖片下載失敗 HTTP ${response.status}`)

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!contentType.startsWith('image/')) throw new Error(`不是圖片內容 (${contentType || 'unknown'})`)

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_IMAGE_BYTES) throw new Error(`圖片過大 (${contentLength} bytes)`)

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`圖片過大 (${buffer.length} bytes)`)
  if (buffer.length < 64) throw new Error('圖片資料過小')

  return { url, originalIndex, mimeType: contentType, data: buffer.toString('base64') }
}

function buildVisionPrompt(candidate: SourceCandidateInput, images: FetchedImage[]) {
  return [
    '你正在幫 Threads 觀察站辨識貼文附圖。只回單一 JSON 物件，不要 markdown、不要前言。',
    '用繁體中文描述「看得見的內容」。不要猜測看不到的內容；不要根據 URL 或貼文文字臆測圖片。',
    '請輸出 JSON：{"summary":"整體圖片摘要","images":[{"imageIndex":1,"description":"這張圖看見什麼","textDetected":"圖中可讀文字，沒有就 null","notableObjects":["物件1"]}]}',
    `貼文來源：${candidate.source}`,
    `貼文文字（只能作為脈絡，不可用來補圖中看不到的東西）：${candidate.text}`,
    `圖片索引：${images.map((image) => image.originalIndex).join(', ')}`
  ].join('\n')
}

async function callGeminiVision(apiKey: string, model: string, prompt: string, images: FetchedImage[]) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        ...images.map((image) => ({ inline_data: { mime_type: image.mimeType, data: image.data } }))
      ]
    }],
    generationConfig: { maxOutputTokens: 1024 }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEMINI_VISION_TIMEOUT_MS)
  })
  const text = await response.text()
  let parsed: GeminiResponse
  try {
    parsed = JSON.parse(text) as GeminiResponse
  } catch {
    throw new Error(`Gemini vision 回傳非 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`)
  }
  if (!response.ok) throw new Error(`Gemini vision 失敗：${parsed.error?.message ?? `HTTP ${response.status}`}`)

  const resultText = parsed.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text
  if (!resultText) throw new Error('Gemini vision 沒有回傳文字描述')
  return resultText
}
