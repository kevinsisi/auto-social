import { describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'
import { openMemoryDatabase } from '../src/db.js'
import { repipelineCard } from '../src/repipeline.js'
import { PatrolRepository } from '../src/repository.js'
import { nowIso } from '../src/time.js'

type AppDb = ReturnType<typeof openMemoryDatabase>

function seedCandidate(db: AppDb, cardId: string, status: string) {
  const id = nanoid()
  db.prepare(`
    INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, title, text, fetched_at, pipeline_status, pipeline_error, pipeline_completed_at)
    VALUES (?, 'threads_playwright', ?, ?, ?, 0, ?, 't', 'x', ?, ?, ?, ?)
  `).run(id, `e-${id}`, `f-${id}`, cardId, `https://www.threads.com/@u/post/${id}`, nowIso(), status, status === 'pipeline_blocked' ? 'rate limit' : null, status === 'drafted' ? nowIso() : null)
  return id
}

function getPipelineStatus(db: AppDb, id: string) {
  return (db.prepare('SELECT pipeline_status, pipeline_error FROM trend_candidates WHERE id = ?').get(id) as { pipeline_status: string | null; pipeline_error: string | null } | undefined)
}

function pendingTaskCount(db: AppDb) {
  return (db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE type = 'pipeline' AND status = 'pending'").get() as { n: number }).n
}

describe('repipelineCard', () => {
  it('requeues pending / short_circuited / pipeline_blocked candidates and resets their status', () => {
    const db = openMemoryDatabase()
    const card = new PatrolRepository(db).createCard('Urus')
    const a = seedCandidate(db, card.id, 'pending')
    const b = seedCandidate(db, card.id, 'short_circuited')
    const c = seedCandidate(db, card.id, 'pipeline_blocked')
    const d = seedCandidate(db, card.id, 'drafted')

    const result = repipelineCard(db, card.id)

    expect(result.candidatesConsidered).toBe(4)
    expect(result.candidatesQueued).toBe(3)
    expect(result.skippedAlreadyDrafted).toBe(1)
    expect(result.skippedNothingToRun).toBe(false)

    expect(getPipelineStatus(db, a)?.pipeline_status).toBe('pending')
    expect(getPipelineStatus(db, b)?.pipeline_status).toBe('pending')
    expect(getPipelineStatus(db, c)?.pipeline_status).toBe('pending')
    expect(getPipelineStatus(db, c)?.pipeline_error).toBeNull()
    // drafted candidate must not be touched
    expect(getPipelineStatus(db, d)?.pipeline_status).toBe('drafted')

    expect(pendingTaskCount(db)).toBe(3)
  })

  it('reports skippedNothingToRun when every candidate is already drafted', () => {
    const db = openMemoryDatabase()
    const card = new PatrolRepository(db).createCard('Urus')
    seedCandidate(db, card.id, 'drafted')
    seedCandidate(db, card.id, 'drafted')

    const result = repipelineCard(db, card.id)

    expect(result.candidatesQueued).toBe(0)
    expect(result.skippedAlreadyDrafted).toBe(2)
    expect(result.skippedNothingToRun).toBe(true)
    expect(pendingTaskCount(db)).toBe(0)
  })

  it('returns zero counts when card has no candidates', () => {
    const db = openMemoryDatabase()
    const card = new PatrolRepository(db).createCard('empty')

    const result = repipelineCard(db, card.id)

    expect(result.candidatesConsidered).toBe(0)
    expect(result.candidatesQueued).toBe(0)
    expect(result.skippedNothingToRun).toBe(false)
  })

  it('throws when card does not exist', () => {
    const db = openMemoryDatabase()
    expect(() => repipelineCard(db, 'no-such-card')).toThrow('找不到這張海巡卡。')
  })

  it('does not double-enqueue if a pipeline task for the same candidate is already pending', () => {
    const db = openMemoryDatabase()
    const card = new PatrolRepository(db).createCard('Urus')
    const a = seedCandidate(db, card.id, 'pipeline_blocked')

    repipelineCard(db, card.id)
    repipelineCard(db, card.id)

    expect(pendingTaskCount(db)).toBe(1)
    expect(getPipelineStatus(db, a)?.pipeline_status).toBe('pending')
  })
})
