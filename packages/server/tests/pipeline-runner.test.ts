import { describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'
import { openMemoryDatabase } from '../src/db.js'
import { KeyPoolRepository } from '../src/key-pool/key-pool.js'
import { runPipelineOnCandidate } from '../src/scheduler/pipeline-runner.js'
import { nowIso } from '../src/time.js'
import type { TextGenerator } from '../src/ai/types.js'

function seedCandidate(db: ReturnType<typeof openMemoryDatabase>) {
  const id = nanoid()
  db.prepare(`
    INSERT INTO trend_candidates (id, source, external_id, fingerprint, is_trending, url, title, text, fetched_at, pipeline_status)
    VALUES (?, 'threads_playwright', ?, ?, 0, ?, '測試貼文', '我覺得這家手搖飲真的爛，又難喝又貴', ?, 'pending')
  `).run(id, `cand-${id}`, `fp-${id}`, `https://www.threads.com/@user/post/${id}`, nowIso())
  return id
}

function fixtures(overrides: Partial<Record<string, string>> = {}): TextGenerator {
  const defaults: Record<string, string> = {
    classify: JSON.stringify({ topic: '手搖飲抱怨', sensitivity: 'low', voiceFit: 0.7, sentiment: 'complaint', reason: '在抱怨一家店' }),
    sponsored: JSON.stringify({ sponsoredSignal: 'none', reasons: [] }),
    score: JSON.stringify({ engagementWorth: 0.6, risk: 'low', timeliness: 'warm', shouldDraft: true, reason: '可以接話' }),
    draft: JSON.stringify({ variants: [
      { angle: '觀察家', text: '飲料貴又難喝這個 combo 真的是經典款。', length: 18 },
      { angle: '自嘲', text: '我也踩過這雷，後來都先看評價。', length: 14 },
      { angle: '短梗', text: '貴到難喝，難喝到貴。', length: 10 }
    ] }),
    meme: JSON.stringify({ memePrompt: '空杯', sceneIdea: '杯子' })
  }
  return async ({ stepId }) => overrides[stepId] ?? defaults[stepId]!
}

function seedKeyPool(db: ReturnType<typeof openMemoryDatabase>) {
  new KeyPoolRepository(db).importKeys('AIzaValidKey1111111111111111\nAIzaValidKey2222222222222222\nAIzaValidKey3333333333333333\nAIzaValidKey4444444444444444\nAIzaValidKey5555555555555555')
}

describe('runPipelineOnCandidate', () => {
  it('persists classify, sponsored, score, draft variants on success', async () => {
    const db = openMemoryDatabase()
    seedKeyPool(db)
    const id = seedCandidate(db)

    const outcome = await runPipelineOnCandidate(db, id, { generator: fixtures() })

    expect(outcome.status).toBe('drafted')
    const row = db.prepare('SELECT pipeline_status, classify_json, sponsored_json, score_json, draft_variants_json, pipeline_error FROM trend_candidates WHERE id = ?').get(id) as any
    expect(row.pipeline_status).toBe('drafted')
    expect(row.pipeline_error).toBeNull()
    expect(JSON.parse(row.classify_json).sentiment).toBe('complaint')
    expect(JSON.parse(row.sponsored_json).sponsoredSignal).toBe('none')
    expect(JSON.parse(row.score_json).shouldDraft).toBe(true)
    const variants = JSON.parse(row.draft_variants_json)
    expect(variants).toHaveLength(3)
  })

  it('records short_circuited when score says do not draft', async () => {
    const db = openMemoryDatabase()
    seedKeyPool(db)
    const id = seedCandidate(db)

    const outcome = await runPipelineOnCandidate(db, id, {
      generator: fixtures({ score: JSON.stringify({ engagementWorth: 0.1, risk: 'high', timeliness: 'cold', shouldDraft: false, reason: '太燙' }) })
    })

    expect(outcome.status).toBe('short_circuited')
    const row = db.prepare('SELECT pipeline_status, draft_variants_json FROM trend_candidates WHERE id = ?').get(id) as any
    expect(row.pipeline_status).toBe('short_circuited')
    expect(row.draft_variants_json).toBeNull()
  })

  it('records pipeline_blocked when classify JSON is malformed', async () => {
    const db = openMemoryDatabase()
    seedKeyPool(db)
    const id = seedCandidate(db)

    const outcome = await runPipelineOnCandidate(db, id, { generator: fixtures({ classify: 'not-json' }) })

    expect(outcome.status).toBe('pipeline_blocked')
    const row = db.prepare('SELECT pipeline_status, pipeline_error FROM trend_candidates WHERE id = ?').get(id) as any
    expect(row.pipeline_status).toBe('pipeline_blocked')
    expect(row.pipeline_error).toMatch(/classify/i)
  })

  it('skips a candidate that does not exist', async () => {
    const db = openMemoryDatabase()
    seedKeyPool(db)

    const outcome = await runPipelineOnCandidate(db, 'no-such-id', { generator: fixtures() })

    expect(outcome.status).toBe('skipped')
  })
})
