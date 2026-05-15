import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { scanKeywordCard } from '../src/keyword-scan.js'
import { PatrolRepository } from '../src/repository.js'
import { DailyQuotaExceededError, KillSwitchActiveError } from '../src/threads-bot/throttle.js'

const searchThreadsWithPlaywrightMock = vi.hoisted(() => vi.fn())
const fetchThreadsSearchOutcomeMock = vi.hoisted(() => vi.fn())

vi.mock('../src/threads-bot/search.js', () => ({
  searchThreadsWithPlaywright: searchThreadsWithPlaywrightMock
}))

vi.mock('../src/sources/threads-search.js', () => ({
  fetchThreadsSearchOutcome: fetchThreadsSearchOutcomeMock
}))

describe('scanKeywordCard', () => {
  beforeEach(() => {
    searchThreadsWithPlaywrightMock.mockReset()
    fetchThreadsSearchOutcomeMock.mockReset()
  })

  it('falls back to Google when Playwright search quota is exhausted', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    searchThreadsWithPlaywrightMock.mockRejectedValue(new DailyQuotaExceededError('search', 200))
    fetchThreadsSearchOutcomeMock.mockResolvedValue({
      candidates: [
        { source: 'threads_search', url: 'https://www.threads.com/@cars/post/1', title: 'Threads 搜尋結果：Urus', excerpt: 'Google 備援連結' }
      ],
      status: 'ok',
      providerUsed: 'google',
      blockedProviders: []
    })

    const run = await scanKeywordCard(db, card.id)

    expect(run.outcomeKind).toBe('fallback_ok')
    expect(run.providerUsed).toBe('google')
    expect(run.message).toContain('已改用 Google site:threads.net/site:threads.com 備援')
    const row = db.prepare('SELECT source, card_id FROM trend_candidates WHERE url = ?').get('https://www.threads.com/@cars/post/1') as { source: string; card_id: string }
    expect(row).toMatchObject({ source: 'threads_search', card_id: card.id })
  })

  it('falls back to Bing when Google is blocked', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    searchThreadsWithPlaywrightMock.mockRejectedValue(new DailyQuotaExceededError('search', 200))
    fetchThreadsSearchOutcomeMock.mockResolvedValue({
      candidates: [
        { source: 'threads_search', url: 'https://www.threads.com/@cars/post/2', title: 'Threads 搜尋結果：Urus', excerpt: 'Bing 備援連結' }
      ],
      status: 'ok',
      providerUsed: 'bing',
      blockedProviders: ['google']
    })

    const run = await scanKeywordCard(db, card.id)

    expect(run.outcomeKind).toBe('fallback_ok')
    expect(run.providerUsed).toBe('bing')
    expect(run.blockedProviders).toEqual(['google'])
    expect(run.message).toContain('已改用 Bing site:threads.net/site:threads.com 備援')
  })

  it('distinguishes search_provider_blocked from no_matching_threads_results', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    searchThreadsWithPlaywrightMock.mockRejectedValue(new DailyQuotaExceededError('search', 200))
    fetchThreadsSearchOutcomeMock.mockResolvedValue({
      candidates: [],
      status: 'blocked',
      providerUsed: null,
      blockedProviders: ['google', 'bing']
    })

    const run = await scanKeywordCard(db, card.id)

    expect(run.outcomeKind).toBe('search_provider_blocked')
    expect(run.providerUsed).toBeNull()
    expect(run.blockedProviders).toEqual(['google', 'bing'])
    expect(run.message).toContain('備援搜尋（Google、Bing）被阻擋')
  })

  it('reports no_matching_threads_results when providers respond but find nothing', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    searchThreadsWithPlaywrightMock.mockRejectedValue(new DailyQuotaExceededError('search', 200))
    fetchThreadsSearchOutcomeMock.mockResolvedValue({
      candidates: [],
      status: 'no_results',
      providerUsed: null,
      blockedProviders: []
    })

    const run = await scanKeywordCard(db, card.id)

    expect(run.outcomeKind).toBe('no_matching_threads_results')
    expect(run.message).toContain('備援搜尋未找到')
  })

  it('does not bypass the kill switch with fallback search', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    searchThreadsWithPlaywrightMock.mockRejectedValue(new KillSwitchActiveError())

    await expect(scanKeywordCard(db, card.id)).rejects.toBeInstanceOf(KillSwitchActiveError)
    expect(fetchThreadsSearchOutcomeMock).not.toHaveBeenCalled()
  })
})
