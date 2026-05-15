import { nanoid } from 'nanoid'
import { StepRunner } from '@kevinsisi/ai-core/step-orchestration'
import type { AppDatabase } from './db.js'
import { createGeminiTextGenerator } from './ai/gemini-client.js'
import { buildSystemInstruction } from './ai/prompt-builder.js'
import { buildComposePostPrompt, parseComposePost, type ComposePostInput } from './ai/steps/compose-post.js'
import { DEFAULT_VOICE_PROFILE, type TextGenerator } from './ai/types.js'
import { createKeyPool } from './key-pool/key-pool.js'
import { generateImageForDraft, ImageGenNotConfiguredError } from './image-gen/gemini-image.js'
import { getImageGenStatus } from './image-gen/settings.js'
import { getRadarTrends } from './radar-trends.js'
import { enqueueTask } from './scheduler/task-queue.js'
import { nowIso } from './time.js'

export type PostDraft = {
  id: string
  seedKeyword: string | null
  seedTopic: string | null
  angle: string | null
  text: string
  imagePrompt: string | null
  imagePath: string | null
  imageProvider: string | null
  imageError: string | null
  status: string
  createdAt: string
  decidedAt: string | null
  postedAt: string | null
  postedUrl: string | null
}

type RawPostDraftRow = {
  id: string
  seed_keyword: string | null
  seed_topic: string | null
  angle: string | null
  text: string
  image_prompt: string | null
  image_path: string | null
  image_provider: string | null
  image_error: string | null
  status: string
  created_at: string
  decided_at: string | null
  posted_at: string | null
  posted_url: string | null
}

type ComposeSeedRow = {
  author: string | null
  text: string
  classify_json: string | null
}

export function listPostDrafts(db: AppDatabase, limit = 12): PostDraft[] {
  const rows = db.prepare(`
    SELECT id, seed_keyword, seed_topic, angle, text, image_prompt, image_path, image_provider, image_error, status, created_at, decided_at, posted_at, posted_url
    FROM post_drafts
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as RawPostDraftRow[]
  return rows.map(mapPostDraft)
}

export function enqueueComposePostDraft(db: AppDatabase) {
  const payload = buildComposePostInput(db)
  if (!payload) throw new Error('目前沒有足夠的雷達樣本可供發文發想。先跑一次 Threads 海巡。')
  const taskId = enqueueTask(db, {
    type: 'compose_post',
    label: `以「${payload.seedKeyword}」發想新貼文`,
    payload,
    priority: 4,
    dedupeKey: `compose:${payload.seedKeyword}`
  })
  return { taskId, payload }
}

export async function composePostTaskHandler(db: AppDatabase, payload: ComposePostInput, options: { generator?: TextGenerator } = {}) {
  const pool = createKeyPool(db)
  const generator = options.generator ?? createGeminiTextGenerator()
  const runner = new StepRunner(pool)
  const prompt = buildComposePostPrompt(payload)
  const raw = await runner.runStep({
    id: 'compose_post',
    name: 'Compose post idea',
    preferredKey: null,
    allowSharedFallback: true,
    run: async (apiKey) => generator({
      stepId: 'compose_post',
      systemInstruction: buildSystemInstruction(DEFAULT_VOICE_PROFILE, 'voice'),
      prompt,
      preferredKey: apiKey
    })
  })
  const parsed = parseComposePost(raw.value)
  const id = nanoid()
  const createdAt = nowIso()
  db.prepare(`
    INSERT INTO post_drafts (id, seed_keyword, seed_topic, angle, text, image_prompt, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, parsed.seedKeyword, parsed.seedTopic, parsed.angle, parsed.text, parsed.imagePrompt || null, createdAt)

  // Best-effort image generation. Never fails the compose task — surface the error in image_error.
  if (parsed.imagePrompt && parsed.imagePrompt.trim() && getImageGenStatus(db).configured) {
    void regenerateImageForPostDraft(db, id).catch(() => undefined)
  }

  return { draftId: id, text: parsed.text, seedKeyword: parsed.seedKeyword }
}

export async function regenerateImageForPostDraft(db: AppDatabase, draftId: string) {
  const row = db.prepare('SELECT image_prompt FROM post_drafts WHERE id = ?').get(draftId) as { image_prompt: string | null } | undefined
  if (!row) throw new Error(`找不到 post draft：${draftId}`)
  const prompt = row.image_prompt?.trim()
  if (!prompt) throw new Error('這則 draft 沒有 imagePrompt，無法生圖。')

  db.prepare('UPDATE post_drafts SET image_error = NULL WHERE id = ?').run(draftId)
  try {
    const image = await generateImageForDraft(db, draftId, prompt)
    db.prepare(`
      UPDATE post_drafts
      SET image_path = ?, image_provider = ?, image_error = NULL
      WHERE id = ?
    `).run(image.relativePath, `gemini:${image.model}`, draftId)
    return { ok: true as const, relativePath: image.relativePath, provider: `gemini:${image.model}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'image gen failed'
    db.prepare('UPDATE post_drafts SET image_error = ? WHERE id = ?').run(message, draftId)
    if (error instanceof ImageGenNotConfiguredError) throw error
    return { ok: false as const, error: message }
  }
}

function buildComposePostInput(db: AppDatabase): ComposePostInput | null {
  const radar = getRadarTrends(db)
  const radarTerms = radar.terms.slice(0, 8).map((term) => term.word)
  const rows = db.prepare(`
    SELECT author, text, classify_json
    FROM trend_candidates
    WHERE is_trending = 1
    ORDER BY fetched_at DESC
    LIMIT 8
  `).all() as ComposeSeedRow[]
  if (rows.length === 0) return null
  const posts = rows
    .map((row) => ({
      author: row.author,
      topic: parseTopic(row.classify_json),
      excerpt: row.text.trim().replace(/\s+/g, ' ').slice(0, 180)
    }))
    .filter((row) => row.excerpt.length >= 12)
  if (posts.length === 0) return null
  return {
    seedKeyword: radarTerms[0] ?? '台灣 Threads',
    radarTerms,
    posts
  }
}

function parseTopic(classifyJson: string | null) {
  if (!classifyJson) return null
  try {
    const parsed = JSON.parse(classifyJson) as { topic?: unknown }
    return typeof parsed.topic === 'string' ? parsed.topic : null
  } catch {
    return null
  }
}

function mapPostDraft(row: RawPostDraftRow): PostDraft {
  return {
    id: row.id,
    seedKeyword: row.seed_keyword,
    seedTopic: row.seed_topic,
    angle: row.angle,
    text: row.text,
    imagePrompt: row.image_prompt,
    imagePath: row.image_path,
    imageProvider: row.image_provider,
    imageError: row.image_error,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    postedAt: row.posted_at,
    postedUrl: row.posted_url
  }
}
