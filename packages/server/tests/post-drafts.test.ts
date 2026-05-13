import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { composePostTaskHandler, enqueueComposePostDraft, listPostDrafts } from '../src/post-drafts.js'
import { KeyPoolRepository } from '../src/key-pool/key-pool.js'

describe('post draft composer', () => {
  it('enqueues a compose_post task from recent radar context', () => {
    const db = openMemoryDatabase()
    seedTrend(db)

    const result = enqueueComposePostDraft(db)

    expect(result.taskId).toBeTruthy()
    expect(result.payload.seedKeyword).toBe('台灣')
    const task = db.prepare('SELECT type, label, status FROM ai_tasks WHERE id = ?').get(result.taskId) as { type: string; label: string; status: string }
    expect(task).toMatchObject({ type: 'compose_post', status: 'pending' })
  })

  it('persists one post draft row when compose task succeeds', async () => {
    const db = openMemoryDatabase()
    seedTrend(db)
    new KeyPoolRepository(db).importKeys('AIzaValidKey1111111111111111')

    const { payload } = enqueueComposePostDraft(db)
    const output = await composePostTaskHandler(db, payload, {
      generator: async () => JSON.stringify({
        seedKeyword: '台灣',
        seedTopic: '日常觀察',
        angle: '觀察',
        text: '台灣很多事不是突然變怪，是你某天終於有空看清楚。',
        imagePrompt: '台灣城市夜色，路人低頭滑手機，霓虹和便利商店光感。'
      })
    })

    expect(output.seedKeyword).toBe('台灣')
    const drafts = listPostDrafts(db)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      seedKeyword: '台灣',
      seedTopic: '日常觀察',
      angle: '觀察'
    })
    expect(drafts[0]!.text).toContain('台灣很多事')
  })
})

function seedTrend(db: ReturnType<typeof openMemoryDatabase>) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO trend_candidates (id, source, external_id, fingerprint, is_trending, url, author, title, text, fetched_at, pipeline_status, classify_json)
    VALUES ('cand-1', 'threads_playwright', 'ext-1', 'fp-1', 1, 'https://www.threads.com/@u/post/1', '@u', '台灣生活', '台灣生活最近一直在講日常疲勞跟群組社交壓力', ?, 'drafted', ?)
  `).run(now, JSON.stringify({ topic: '台灣生活壓力', sentiment: 'complaint', voiceFit: 0.8, sensitivity: 'low', reason: 'r' }))
}
