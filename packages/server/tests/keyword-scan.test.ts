import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { scanKeywordCard } from '../src/keyword-scan.js'
import { PatrolRepository } from '../src/repository.js'

const fetchThreadsSearchOutcomeMock = vi.hoisted(() => vi.fn())

vi.mock('../src/sources/threads-search.js', () => ({
  fetchThreadsSearchOutcome: fetchThreadsSearchOutcomeMock
}))

describe('scanKeywordCard', () => {
  beforeEach(() => {
    fetchThreadsSearchOutcomeMock.mockReset()
  })

  it('uses Google/Bing fallback search without Threads Playwright', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
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
    expect(run.message).toContain('已使用 Google site:threads.net/site:threads.com 搜尋')
    const row = db.prepare('SELECT source, card_id FROM trend_candidates WHERE url = ?').get('https://www.threads.com/@cars/post/1') as { source: string; card_id: string }
    expect(row).toMatchObject({ source: 'threads_search', card_id: card.id })
  })

  it('uses Bing when Bing is the fallback provider', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
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
    expect(run.message).toContain('已使用 Bing site:threads.net/site:threads.com 搜尋')
  })

  it('distinguishes search_provider_blocked from no_matching_threads_results', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
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
    expect(run.message).toContain('Threads 搜尋（Google、Bing）被阻擋')
  })

  it('reports no_matching_threads_results when providers respond but find nothing', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
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

  it('never calls Threads Playwright search', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    fetchThreadsSearchOutcomeMock.mockResolvedValue({ candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] })

    await scanKeywordCard(db, card.id)

    expect(fetchThreadsSearchOutcomeMock).toHaveBeenCalledWith('Urus', undefined, db)
  })
})
