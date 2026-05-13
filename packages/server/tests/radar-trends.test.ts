import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { extractRadarTerms, getRadarTrends, upsertTrendCandidate } from '../src/radar-trends.js'

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

describe('upsertTrendCandidate', () => {
  it('backfills engagement and cleaned text for existing URLs', () => {
    const db = openMemoryDatabase()
    const first = upsertTrendCandidate(db, {
      source: 'threads_playwright',
      url: 'https://www.threads.com/@u/post/1',
      title: '舊標題',
      excerpt: '舊文 留言64轉發 分享949',
      author: '@u',
      postedAt: null,
      likes: null,
      replyCount: null,
      reposts: null,
      shares: null,
      images: []
    })

    const second = upsertTrendCandidate(db, {
      source: 'threads_playwright',
      url: 'https://www.threads.com/@u/post/1',
      title: '新標題',
      excerpt: '乾淨貼文',
      author: '@u',
      postedAt: '2026-05-13T08:00:00.000Z',
      likes: 10,
      replyCount: 64,
      reposts: 1,
      shares: 949,
      images: ['https://cdninstagram.com/image.jpg']
    })

    const row = db.prepare('SELECT id, title, text, engagement_json, images_json FROM trend_candidates WHERE url = ?').get('https://www.threads.com/@u/post/1') as { id: string; title: string; text: string; engagement_json: string; images_json: string }

    expect(first.inserted).toBe(true)
    expect(second).toEqual({ id: first.id, inserted: false })
    expect(row.title).toBe('新標題')
    expect(row.text).toBe('乾淨貼文')
    expect(JSON.parse(row.engagement_json)).toMatchObject({ likes: 10, replies: 64, reposts: 1, shares: 949 })
    expect(JSON.parse(row.images_json)).toEqual(['https://cdninstagram.com/image.jpg'])
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
