import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { scanKeywordCard } from '../src/keyword-scan.js'
import { PatrolRepository } from '../src/repository.js'
import { DailyQuotaExceededError, KillSwitchActiveError } from '../src/threads-bot/throttle.js'

const searchThreadsWithPlaywrightMock = vi.hoisted(() => vi.fn())
const fetchThreadsSearchCandidatesMock = vi.hoisted(() => vi.fn())

vi.mock('../src/threads-bot/search.js', () => ({
  searchThreadsWithPlaywright: searchThreadsWithPlaywrightMock
}))

vi.mock('../src/sources/threads-search.js', () => ({
  fetchThreadsSearchCandidates: fetchThreadsSearchCandidatesMock
}))

describe('scanKeywordCard', () => {
  beforeEach(() => {
    searchThreadsWithPlaywrightMock.mockReset()
    fetchThreadsSearchCandidatesMock.mockReset()
  })

  it('falls back to Google Threads search when Playwright search quota is exhausted', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    searchThreadsWithPlaywrightMock.mockRejectedValue(new DailyQuotaExceededError('search', 200))
    fetchThreadsSearchCandidatesMock.mockResolvedValue([
      { source: 'threads_search', url: 'https://www.threads.com/@cars/post/1', title: 'Threads 搜尋結果：Urus', excerpt: 'Google 找到的 Threads 連結；開頁確認原文後再互動。' }
    ])

    const run = await scanKeywordCard(db, card.id)

    expect(run.status).toBe('completed')
    expect(run.message).toContain('已改用 Google site:threads.net/site:threads.com 備援')
    expect(fetchThreadsSearchCandidatesMock).toHaveBeenCalledWith('Urus')
    const row = db.prepare('SELECT source, card_id FROM trend_candidates WHERE url = ?').get('https://www.threads.com/@cars/post/1') as { source: string; card_id: string }
    expect(row).toMatchObject({ source: 'threads_search', card_id: card.id })
  })

  it('does not bypass the kill switch with Google search fallback', async () => {
    const db = openMemoryDatabase()
    const repo = new PatrolRepository(db)
    const card = repo.createCard('Urus')
    searchThreadsWithPlaywrightMock.mockRejectedValue(new KillSwitchActiveError())

    await expect(scanKeywordCard(db, card.id)).rejects.toBeInstanceOf(KillSwitchActiveError)
    expect(fetchThreadsSearchCandidatesMock).not.toHaveBeenCalled()
  })
})
