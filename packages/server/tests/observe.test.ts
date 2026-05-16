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
      VALUES (?, 'threads_playwright', ?, ?, ?, 0, ?, '@u', 'AI 小編貼文', 'AI 小編貼文內容', ?, ?, ?, 'drafted', ?, ?, ?, ?, NULL, ?)
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

  it('hides unrelated legacy rows that do not mention the card keyword', () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')

    db.prepare(`
      INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, fetched_at, pipeline_status)
      VALUES ('legacy-noise', 'threads_playwright', 'legacy-noise', 'fp-legacy-noise', ?, 0, 'https://www.threads.com/@girl/post/1', '@girl', '自拍', 'Mastaruu.. selfie post', ?, ?, ?, 'short_circuited')
    `).run(card.id, nowIso(), JSON.stringify({ likes: 676, replies: 91, reposts: 4, shares: 13 }), nowIso())

    const result = getKeywordObservation(db, card.id)

    expect(result).not.toBeNull()
    expect(result!.aggregate.totalSamples).toBe(0)
    expect(result!.highlights).toEqual([])
    expect(result!.posts).toEqual([])
  })

  it('hides legacy rows published more than one year ago', () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    const now = new Date('2026-05-14T00:00:00.000Z')

    db.prepare(`
      INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, fetched_at, pipeline_status)
      VALUES ('old-urus', 'threads_playwright', 'old-urus', 'fp-old-urus', ?, 0, 'https://www.threads.com/@cars/post/1', '@cars', 'Urus 老文', 'Urus 改裝分享', '2024-05-13T23:59:59.999Z', ?, ?, 'short_circuited')
    `).run(card.id, JSON.stringify({ likes: 999, replies: 99 }), now.toISOString())

    const result = getKeywordObservation(db, card.id, now)

    expect(result).not.toBeNull()
    expect(result!.aggregate.totalSamples).toBe(0)
    expect(result!.highlights).toEqual([])
    expect(result!.posts).toEqual([])
  })

  it('suggests related keywords from current observed posts without auto-expanding', () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    const now = new Date('2026-05-14T00:00:00.000Z')

    db.prepare(`
      INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, fetched_at, pipeline_status, classify_json)
      VALUES ('suggest-urus', 'threads_playwright', 'suggest-urus', 'fp-suggest-urus', ?, 0, 'https://www.threads.com/@cars/post/2', '@cars', 'Urus 與 藍寶堅尼', 'Urus 改裝分享，藍寶堅尼 SUV 保養成本', ?, ?, ?, 'drafted', ?)
    `).run(card.id, now.toISOString(), JSON.stringify({ likes: 20, replies: 2 }), now.toISOString(), JSON.stringify({ topic: '藍寶堅尼 SUV', sentiment: 'neutral', voiceFit: 0.5 }))

    const result = getKeywordObservation(db, card.id, now)

    expect(result).not.toBeNull()
    expect(result!.suggestedKeywords).toContain('藍寶堅尼')
    expect(result!.suggestedKeywords).not.toContain('Urus')
  })

  it('does not suggest truncated mixed-language fragments', () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    const now = new Date('2026-05-14T00:00:00.000Z')

    db.prepare(`
      INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, fetched_at, pipeline_status)
      VALUES ('mixed-token', 'threads_playwright', 'mixed-token', 'fp-mixed-token', ?, 0, 'https://www.threads.com/@cars/post/3', '@cars', 'Urus', '尋找一台Lamborghini Urus，MANSORY套件也可以', ?, ?, ?, 'short_circuited')
    `).run(card.id, now.toISOString(), JSON.stringify({ likes: 5 }), now.toISOString())

    const result = getKeywordObservation(db, card.id, now)

    expect(result).not.toBeNull()
    expect(result!.suggestedKeywords).toContain('MANSORY套件')
    expect(result!.suggestedKeywords).not.toContain('尋找一台Lambor')
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

  it('exposes the latest reply attempt for each observed post', () => {
    const db = openMemoryDatabase()
    const { cardId, candidateIds } = seed(db)
    const candidateId = candidateIds[0]!
    db.prepare(`
      INSERT INTO reply_attempts (id, card_id, candidate_id, target_url, reply_text, bound_handle, status, created_at, updated_at)
      VALUES ('reply-old', ?, ?, 'https://www.threads.com/@u/post/old', 'old', '@kevin', 'failed', '2026-05-14T00:00:00.000Z', '2026-05-14T00:00:00.000Z')
    `).run(cardId, candidateId)
    db.prepare(`
      INSERT INTO reply_attempts (id, card_id, candidate_id, target_url, reply_text, bound_handle, status, reply_url, created_at, updated_at)
      VALUES ('reply-new', ?, ?, 'https://www.threads.com/@u/post/new', 'new', '@kevin', 'succeeded', 'https://www.threads.com/@kevin/post/reply', '2026-05-14T00:01:00.000Z', '2026-05-14T00:01:00.000Z')
    `).run(cardId, candidateId)

    const result = getKeywordObservation(db, cardId)
    const allPosts = [...result!.highlights, ...result!.posts]
    const post = allPosts.find((item) => item.id === candidateId)

    expect(post?.latestReplyAttempt).toMatchObject({ id: 'reply-new', status: 'succeeded', replyUrl: 'https://www.threads.com/@kevin/post/reply' })
  })

  it('exposes image analysis for observed posts', () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    db.prepare(`
      INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, images_json, image_analysis_json, fetched_at, pipeline_status)
      VALUES ('image-urus', 'threads_playwright', 'image-urus', 'fp-image-urus', ?, 0, 'https://www.threads.com/@cars/post/image', '@cars', 'Urus 圖片', 'Urus 新車照片', ?, ?, ?, ?, ?, 'drafted')
    `).run(
      card.id,
      nowIso(),
      JSON.stringify({ likes: 12 }),
      JSON.stringify(['https://cdn.example.com/urus.jpg']),
      JSON.stringify({ status: 'success', summary: '圖片是一台黑色 Urus', images: [{ url: 'https://cdn.example.com/urus.jpg', description: '黑色 SUV', textDetected: null, notableObjects: ['SUV'] }], error: null, model: 'test-vision', analyzedAt: nowIso() }),
      nowIso()
    )

    const result = getKeywordObservation(db, card.id)
    const post = [...result!.highlights, ...result!.posts].find((item) => item.id === 'image-urus')

    expect(post?.imageAnalysis).toMatchObject({ status: 'success', summary: '圖片是一台黑色 Urus' })
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
        VALUES (?, 'threads_playwright', ?, ?, ?, 0, ?, '@u', '排序測試貼文', '排序測試貼文內容', ?, ?, ?, 'drafted')
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
