import type { AppDatabase } from './db.js'
import { schedulePipelineForCandidates } from './radar-trends.js'

export type RepipelineResult = {
  cardId: string
  candidatesConsidered: number
  candidatesQueued: number
  skippedAlreadyDrafted: number
  skippedNothingToRun: boolean
}

export type RepipelineCandidateResult = {
  cardId: string
  candidateId: string
  queued: boolean
  skippedReason: 'already_drafted' | 'already_queued' | null
}

const REQUEUEABLE_STATUSES = ['pending', 'short_circuited', 'pipeline_blocked'] as const

export function repipelineCard(db: AppDatabase, cardId: string): RepipelineResult {
  const card = db.prepare('SELECT id FROM patrol_cards WHERE id = ?').get(cardId) as { id: string } | undefined
  if (!card) throw new Error('找不到這張海巡卡。')

  const allRows = db.prepare(`
    SELECT id, pipeline_status
    FROM trend_candidates
    WHERE card_id = ?
  `).all(cardId) as Array<{ id: string; pipeline_status: string | null }>

  const total = allRows.length
  const requeueable = allRows.filter((row) => (REQUEUEABLE_STATUSES as readonly string[]).includes(row.pipeline_status ?? ''))
  const skippedAlreadyDrafted = total - requeueable.length

  if (requeueable.length === 0) {
    return { cardId, candidatesConsidered: total, candidatesQueued: 0, skippedAlreadyDrafted, skippedNothingToRun: total > 0 }
  }

  const ids = requeueable.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`
    UPDATE trend_candidates
    SET pipeline_status = 'pending', pipeline_error = NULL, pipeline_completed_at = NULL
    WHERE id IN (${placeholders})
  `).run(...ids)

  schedulePipelineForCandidates(db, ids)
  return { cardId, candidatesConsidered: total, candidatesQueued: ids.length, skippedAlreadyDrafted, skippedNothingToRun: false }
}

export function repipelineCandidate(db: AppDatabase, cardId: string, candidateId: string): RepipelineCandidateResult {
  const card = db.prepare('SELECT id FROM patrol_cards WHERE id = ?').get(cardId) as { id: string } | undefined
  if (!card) throw new Error('找不到這張海巡卡。')

  const row = db.prepare(`
    SELECT id, pipeline_status
    FROM trend_candidates
    WHERE id = ? AND card_id = ?
  `).get(candidateId, cardId) as { id: string; pipeline_status: string | null } | undefined
  if (!row) throw new Error('找不到這則樣本。')

  const status = row.pipeline_status ?? ''
  if (status === 'drafted') return { cardId, candidateId, queued: false, skippedReason: 'already_drafted' }
  if (status === 'pending') return { cardId, candidateId, queued: false, skippedReason: 'already_queued' }
  if (!(REQUEUEABLE_STATUSES as readonly string[]).includes(status)) return { cardId, candidateId, queued: false, skippedReason: 'already_drafted' }

  db.prepare(`
    UPDATE trend_candidates
    SET pipeline_status = 'pending', pipeline_error = NULL, pipeline_completed_at = NULL
    WHERE id = ? AND card_id = ?
  `).run(candidateId, cardId)

  schedulePipelineForCandidates(db, [candidateId])
  return { cardId, candidateId, queued: true, skippedReason: null }
}
