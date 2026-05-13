import { describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'
import { openMemoryDatabase } from '../src/db.js'
import { getKeywordObservation, saveVoiceFeedback } from '../src/observe.js'
import { PatrolRepository } from '../src/repository.js'
import { nowIso } from '../src/time.js'

type Seed = {
  cardId: string
  candidateIds: string[]
}

function seed(db: ReturnType<typeof openMemoryDatabase>): Seed {
  const repo = new PatrolRepository(db)
  const card = repo.createCard('AI 小編')
  const ids: string[] = []
  const samples = [
    { sentiment: 'complaint', sponsored: 'none', shouldDraft: true },
    { sentiment: 'complaint', sponsored: 'none', shouldDraft: true },
    { sentiment: 'help', sponsored: 'none', shouldDraft: true },
    { sentiment: 'sarcasm', sponsored: 'suspect', shouldDraft: true },
    { sentiment: 'positive', sponsored: 'likely', shouldDraft: false }
  ]
  for (const sample of samples) {
    const id = nanoid()
    ids.push(id)
    db.prepare(`
      INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, fetched_at, pipeline_status, classify_json, sponsored_json, score_json, draft_variants_json, pipeline_error, pipeline_completed_at)
      VALUES (?, 'threads_playwright', ?, ?, ?, 0, ?, '@u', '貼文', '貼文內容', ?, ?, ?, 'drafted', ?, ?, ?, ?, NULL, ?)
    `).run(
      id,
      `ext-${id}`,
      `fp-${id}`,
      card.id,
      `https://www.threads.com/@u/post/${id}`,
      nowIso(),
      JSON.stringify({ likes: 5, replies: 1 }),
      nowIso(),
      JSON.stringify({ topic: 't', sensitivity: 'low', voiceFit: 0.6, sentiment: sample.sentiment, reason: 'r' }),
      JSON.stringify({ sponsoredSignal: sample.sponsored, reasons: sample.sponsored === 'none' ? [] : ['理由'] }),
      JSON.stringify({ engagementWorth: 0.5, risk: 'low', timeliness: 'warm', shouldDraft: sample.shouldDraft, reason: 'r' }),
      sample.shouldDraft ? JSON.stringify([{ angle: '觀察家', text: 'AI 草稿', length: 5 }]) : null,
      nowIso()
    )
  }
  return { cardId: card.id, candidateIds: ids }
}

describe('getKeywordObservation', () => {
  it('returns aggregate sentiment distribution and per-post detail', () => {
    const db = openMemoryDatabase()
    const { cardId } = seed(db)

    const result = getKeywordObservation(db, cardId)

    expect(result).not.toBeNull()
    expect(result!.card.keyword).toBe('AI 小編')
    expect(result!.aggregate.totalSamples).toBe(5)
    expect(result!.aggregate.classifiedSamples).toBe(5)
    expect(result!.aggregate.sentimentDistribution.complaint.count).toBe(2)
    expect(result!.aggregate.sentimentDistribution.complaint.pct).toBeCloseTo(0.4)
    expect(result!.aggregate.sentimentDistribution.help.count).toBe(1)
    expect(result!.aggregate.sentimentDistribution.sarcasm.count).toBe(1)
    expect(result!.aggregate.sentimentDistribution.positive.count).toBe(1)
    expect(result!.aggregate.sentimentDistribution.anger.count).toBe(0)
    expect(result!.aggregate.sponsoredRate).toBeCloseTo(0.4)
  })

  it('returns null for an unknown card', () => {
    const db = openMemoryDatabase()
    expect(getKeywordObservation(db, 'no-such-card')).toBeNull()
  })

  it('returns empty aggregate for a card with no recent candidates', () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('冷門詞')

    const result = getKeywordObservation(db, card.id)

    expect(result).not.toBeNull()
    expect(result!.aggregate.totalSamples).toBe(0)
    expect(result!.aggregate.classifiedSamples).toBe(0)
    expect(result!.aggregate.sponsoredRate).toBe(0)
    expect(result!.posts).toEqual([])
    for (const bucket of Object.values(result!.aggregate.sentimentDistribution)) {
      expect(bucket.count).toBe(0)
      expect(bucket.pct).toBe(0)
    }
  })

  it('exposes the first draft variant as the training draft', () => {
    const db = openMemoryDatabase()
    const { cardId } = seed(db)

    const result = getKeywordObservation(db, cardId)
    const allPosts = [...result!.highlights, ...result!.posts]
    const draftedPosts = allPosts.filter((post) => post.draft !== null)

    expect(draftedPosts.length).toBeGreaterThan(0)
    expect(draftedPosts[0]!.draft).toMatchObject({ variantIdx: 0, angle: '觀察家', text: 'AI 草稿' })
  })

  it('splits high-engagement posts into highlights and sorts the rest by engagement', () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('排序測試')
    const samples = [
      { ext: 'low-1', likes: 2, replies: 0 },
      { ext: 'mid-1', likes: 30, replies: 5 },
      { ext: 'top-1', likes: 500, replies: 80 },
      { ext: 'top-2', likes: 100, replies: 30 },
      { ext: 'low-2', likes: 0, replies: 1 }
    ]
    for (const s of samples) {
      db.prepare(`
        INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, fetched_at, pipeline_status)
        VALUES (?, 'threads_playwright', ?, ?, ?, 0, ?, '@u', '貼文', '貼文內容', ?, ?, ?, 'drafted')
      `).run(s.ext, s.ext, `fp-${s.ext}`, card.id, `https://www.threads.com/@u/post/${s.ext}`, nowIso(), JSON.stringify({ likes: s.likes, replies: s.replies }), nowIso())
    }

    const result = getKeywordObservation(db, card.id)

    expect(result!.highlights.map((p) => p.id)).toEqual(['top-1', 'top-2'])
    expect(new Set(result!.posts.map((p) => p.id))).toEqual(new Set(['mid-1', 'low-1', 'low-2']))
  })
})

describe('saveVoiceFeedback', () => {
  it('writes a row that can be queried back', () => {
    const db = openMemoryDatabase()

    saveVoiceFeedback(db, { draftId: 'draft-1', variantIdx: 0, decision: 'like' })

    const rows = db.prepare('SELECT draft_id, variant_idx, decision FROM voice_feedback').all() as Array<{ draft_id: string; variant_idx: number; decision: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ draft_id: 'draft-1', variant_idx: 0, decision: 'like' })
  })

  it('stores the user comment for rewrite decisions', () => {
    const db = openMemoryDatabase()

    saveVoiceFeedback(db, { draftId: 'draft-2', variantIdx: 0, decision: 'rewrite', comment: '應該更短' })

    const row = db.prepare('SELECT comment FROM voice_feedback WHERE draft_id = ?').get('draft-2') as { comment: string }
    expect(row.comment).toBe('應該更短')
  })
})
