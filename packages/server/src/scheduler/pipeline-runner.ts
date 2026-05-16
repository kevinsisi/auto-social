import type { AppDatabase } from '../db.js'
import { planPreferredKeys, StepRunner } from '@kevinsisi/ai-core/step-orchestration'
import { SocialPipeline } from '../ai/pipeline.js'
import { createGeminiTextGenerator } from '../ai/gemini-client.js'
import { createGeminiImageAnalyzer, imageAnalysisFailed, imageAnalysisNone } from '../ai/image-recognition.js'
import type { ImageAnalysisResult, ImageAnalyzer, PipelineResult, SocialPipelineOptions, SourceCandidateInput, TextGenerator, VoiceProfile } from '../ai/types.js'
import { DEFAULT_VOICE_PROFILE } from '../ai/types.js'
import { createKeyPool } from '../key-pool/key-pool.js'
import { nowIso } from '../time.js'

export type PipelineRunnerOptions = {
  generator?: TextGenerator
  imageAnalyzer?: ImageAnalyzer
  voiceProfile?: VoiceProfile
  pipelineOptions?: SocialPipelineOptions
}

const A1_PIPELINE_OPTIONS: SocialPipelineOptions = {
  runSponsored: true,
  runScam: true,
  runMeme: false
}

type CandidateRow = {
  id: string
  source: string
  url: string
  author: string | null
  title: string | null
  text: string
  engagement_json: string | null
  images_json: string | null
  image_analysis_json: string | null
}

export type PipelineRunOutcome =
  | { candidateId: string; status: 'drafted' | 'short_circuited'; result: PipelineResult }
  | { candidateId: string; status: 'pipeline_blocked'; error: string }
  | { candidateId: string; status: 'skipped'; reason: string }

export async function runPipelineOnCandidate(db: AppDatabase, candidateId: string, options: PipelineRunnerOptions = {}): Promise<PipelineRunOutcome> {
  const row = db.prepare(`
    SELECT id, source, url, author, title, text, engagement_json, images_json, image_analysis_json
    FROM trend_candidates WHERE id = ?
  `).get(candidateId) as CandidateRow | undefined
  if (!row) return { candidateId, status: 'skipped', reason: 'candidate not found' }

  const pool = createKeyPool(db)
  const imageUrls = parseStringArray(row.images_json)

  const candidate: SourceCandidateInput = {
    id: row.id,
    source: row.source,
    url: row.url,
    title: row.title,
    text: row.text,
    author: row.author,
    engagement: row.engagement_json ? safeJson(row.engagement_json) : null,
    imageUrls
  }

  candidate.imageAnalysis = await resolveImageAnalysis(db, candidate, row.image_analysis_json, pool, options.imageAnalyzer ?? createGeminiImageAnalyzer())
  const generator = options.generator ?? createGeminiTextGenerator()
  const pipeline = new SocialPipeline(pool, generator, options.voiceProfile ?? DEFAULT_VOICE_PROFILE, options.pipelineOptions ?? A1_PIPELINE_OPTIONS)

  try {
    const result = await pipeline.run(candidate)
    persistResult(db, candidateId, result)
    return { candidateId, status: result.shortCircuited ? 'short_circuited' : 'drafted', result }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pipeline_blocked: unknown error'
    db.prepare(`
      UPDATE trend_candidates
      SET pipeline_status = 'pipeline_blocked', pipeline_error = ?, pipeline_completed_at = ?
      WHERE id = ?
    `).run(message, nowIso(), candidateId)
    return { candidateId, status: 'pipeline_blocked', error: message }
  }
}

async function resolveImageAnalysis(db: AppDatabase, candidate: SourceCandidateInput, existingJson: string | null, pool: ReturnType<typeof createKeyPool>, analyzer: ImageAnalyzer): Promise<ImageAnalysisResult> {
  const imageUrls = candidate.imageUrls ?? []
  const existing = parseImageAnalysis(existingJson)
  if (existing && canReuseImageAnalysis(existing, imageUrls)) return existing

  if (imageUrls.length === 0) {
    const result = imageAnalysisNone()
    persistImageAnalysis(db, candidate.id, result)
    return result
  }

  try {
    const assignments = await planPreferredKeys(pool, [{ id: 'image-recognition', name: 'Image recognition', allowSharedFallback: true }])
    const assignment = assignments.find((item) => item.stepId === 'image-recognition')
    const runner = new StepRunner(pool)
    const result = await runner.runStep({
      id: 'image-recognition',
      name: assignment?.stepName ?? 'Image recognition',
      preferredKey: assignment?.preferredKey ?? null,
      allowSharedFallback: true,
      run: async (apiKey) => analyzer({ candidate, imageUrls, preferredKey: apiKey })
    })
    persistImageAnalysis(db, candidate.id, result.value)
    return result.value
  } catch (error) {
    const result = imageAnalysisFailed(error instanceof Error ? error.message : String(error))
    persistImageAnalysis(db, candidate.id, result)
    return result
  }
}

function persistImageAnalysis(db: AppDatabase, candidateId: string, result: ImageAnalysisResult) {
  db.prepare('UPDATE trend_candidates SET image_analysis_json = ? WHERE id = ?').run(JSON.stringify(result), candidateId)
}

function parseImageAnalysis(text: string | null): ImageAnalysisResult | null {
  const parsed = parseJson(text)
  if (!parsed || typeof parsed !== 'object') return null
  const value = parsed as Partial<ImageAnalysisResult>
  if (value.status !== 'none' && value.status !== 'success' && value.status !== 'partial' && value.status !== 'failed') return null
  return {
    status: value.status,
    summary: typeof value.summary === 'string' ? value.summary : null,
    images: Array.isArray(value.images) ? value.images.filter(isImageAnalysisImage) : [],
    error: typeof value.error === 'string' ? value.error : null,
    model: typeof value.model === 'string' ? value.model : null,
    analyzedAt: typeof value.analyzedAt === 'string' ? value.analyzedAt : nowIso()
  }
}

function isImageAnalysisImage(value: unknown): value is ImageAnalysisResult['images'][number] {
  if (!value || typeof value !== 'object') return false
  const image = value as ImageAnalysisResult['images'][number]
  return typeof image.url === 'string' && typeof image.description === 'string' && Array.isArray(image.notableObjects)
}

function canReuseImageAnalysis(existing: ImageAnalysisResult, imageUrls: string[]) {
  if (existing.status === 'none') return imageUrls.length === 0
  if (existing.status === 'success' || existing.status === 'partial') {
    const current = new Set(imageUrls)
    return existing.images.length > 0 && existing.images.every((image) => current.has(image.url))
  }
  return false
}

function persistResult(db: AppDatabase, candidateId: string, result: PipelineResult) {
  const status = result.shortCircuited ? 'short_circuited' : 'drafted'
  db.prepare(`
    UPDATE trend_candidates
    SET pipeline_status = ?,
        classify_json = ?,
        sponsored_json = ?,
        scam_json = ?,
        score_json = ?,
        draft_variants_json = ?,
        pipeline_error = NULL,
        pipeline_completed_at = ?
    WHERE id = ?
  `).run(
    status,
    JSON.stringify(result.classify),
    result.sponsored ? JSON.stringify(result.sponsored) : null,
    result.scam ? JSON.stringify(result.scam) : null,
    JSON.stringify(result.score),
    result.draft ? JSON.stringify(result.draft.variants) : null,
    nowIso(),
    candidateId
  )
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseJson(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseStringArray(text: string | null): string[] {
  const parsed = parseJson(text)
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : []
}

export async function runPipelineOnPending(db: AppDatabase, limit = 20, options: PipelineRunnerOptions = {}): Promise<PipelineRunOutcome[]> {
  const rows = db.prepare(`
    SELECT id FROM trend_candidates
    WHERE pipeline_status = 'pending'
    ORDER BY fetched_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string }>

  const outcomes: PipelineRunOutcome[] = []
  for (const row of rows) {
    outcomes.push(await runPipelineOnCandidate(db, row.id, options))
  }
  return outcomes
}

export async function pipelineTaskHandler(db: AppDatabase, payload: { candidateId: string }) {
  const outcome = await runPipelineOnCandidate(db, payload.candidateId)
  if (outcome.status === 'pipeline_blocked') {
    throw new Error(outcome.error)
  }
  return { candidateId: payload.candidateId, status: outcome.status }
}
