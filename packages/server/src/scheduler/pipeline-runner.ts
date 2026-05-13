import type { AppDatabase } from '../db.js'
import { SocialPipeline } from '../ai/pipeline.js'
import { createGeminiTextGenerator } from '../ai/gemini-client.js'
import type { PipelineResult, SocialPipelineOptions, SourceCandidateInput, TextGenerator, VoiceProfile } from '../ai/types.js'
import { DEFAULT_VOICE_PROFILE } from '../ai/types.js'
import { createKeyPool } from '../key-pool/key-pool.js'
import { nowIso } from '../time.js'

export type PipelineRunnerOptions = {
  generator?: TextGenerator
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
}

export type PipelineRunOutcome =
  | { candidateId: string; status: 'drafted' | 'short_circuited'; result: PipelineResult }
  | { candidateId: string; status: 'pipeline_blocked'; error: string }
  | { candidateId: string; status: 'skipped'; reason: string }

export async function runPipelineOnCandidate(db: AppDatabase, candidateId: string, options: PipelineRunnerOptions = {}): Promise<PipelineRunOutcome> {
  const row = db.prepare(`
    SELECT id, source, url, author, title, text, engagement_json
    FROM trend_candidates WHERE id = ?
  `).get(candidateId) as CandidateRow | undefined
  if (!row) return { candidateId, status: 'skipped', reason: 'candidate not found' }

  const candidate: SourceCandidateInput = {
    id: row.id,
    source: row.source,
    url: row.url,
    title: row.title,
    text: row.text,
    author: row.author,
    engagement: row.engagement_json ? safeJson(row.engagement_json) : null
  }

  const pool = createKeyPool(db)
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
