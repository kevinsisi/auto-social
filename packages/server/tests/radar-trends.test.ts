import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { extractRadarTerms, getRadarTrends } from '../src/radar-trends.js'

describe('extractRadarTerms', () => {
  it('derives terms from candidate text without canned defaults', () => {
    const terms = extractRadarTerms('台灣早餐店今天討論 AI 影片。台灣創作者分享 AI 影片工作流。')

    expect(terms).toEqual(expect.arrayContaining([
      { word: 'AI', count: 2 },
      { word: '台灣', count: 2 },
      { word: '影片', count: 2 }
    ]))
    expect(terms.some((term) => term.word === 'AI 小編')).toBe(false)
  })
})

describe('getRadarTrends', () => {
  it('reads recent persisted trend candidates instead of synthetic terms', () => {
    const db = openMemoryDatabase()
    db.prepare(`
      INSERT INTO trend_candidates (id, source, external_id, fingerprint, is_trending, url, title, text, fetched_at, pipeline_status)
      VALUES ('candidate-1', 'threads_search', 'https://threads.net/@a/post/1', 'fp-1', 1, 'https://threads.net/@a/post/1', '台灣早餐', '台灣早餐討論 AI 影片', ?, 'pending')
    `).run(new Date().toISOString())

    const radar = getRadarTrends(db)

    expect(radar.sampledCandidates).toBe(1)
    expect(radar.terms).toEqual(expect.arrayContaining([
      { word: '台灣', count: 2 },
      { word: '早餐', count: 2 },
      { word: 'AI', count: 1 }
    ]))
  })
})
