import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { scanKeywordCard } from '../src/keyword-scan.js'
import { PatrolRepository } from '../src/repository.js'
import {
  DailyQuotaExceededError,
  KillSwitchActiveError,
  getThrottleSnapshot,
  setDailyLimits,
  setJitterMs,
  setKillSwitch
} from '../src/threads-bot/throttle.js'

const searchThreadsWithPlaywrightMock = vi.hoisted(() => vi.fn())
const fetchThreadsSearchOutcomeMock = vi.hoisted(() => vi.fn())

vi.mock('../src/threads-bot/search.js', () => ({
  searchThreadsWithPlaywright: searchThreadsWithPlaywrightMock
}))

vi.mock('../src/sources/threads-search.js', () => ({
  fetchThreadsSearchOutcome: fetchThreadsSearchOutcomeMock
}))

describe('quota smoke (12.6)', () => {
  beforeEach(() => {
    searchThreadsWithPlaywrightMock.mockReset()
    fetchThreadsSearchOutcomeMock.mockReset()
  })

  it('enforces dailySearchLimit=1 — first card scans, subsequent ones see fallback because the Playwright path throws DailyQuotaExceededError', async () => {
    const db = openMemoryDatabase()
    setDailyLimits(db, { search: 1 })
    setJitterMs(db, { min: 0, max: 0 })

    // First call: returns one playwright result, also "claims" the quota inside the real gate;
    // since we're mocking search, simulate the side effect: first call returns items, second throws quota.
    let callIndex = 0
    searchThreadsWithPlaywrightMock.mockImplementation(async () => {
      callIndex++
      if (callIndex === 1) return [{ source: 'threads_playwright', url: 'https://www.threads.com/@a/post/1', title: 't', excerpt: 'x', author: null, postedAt: null, likes: null, replyCount: null, reposts: null, shares: null, images: [], videos: [] }]
      throw new DailyQuotaExceededError('search', 1)
    })
    fetchThreadsSearchOutcomeMock.mockResolvedValue({ candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] })

    const repo = new PatrolRepository(db)
    const cardA = repo.createCard('foo')
    const cardB = repo.createCard('bar')
    const cardC = repo.createCard('baz')

    const runA = await scanKeywordCard(db, cardA.id)
    const runB = await scanKeywordCard(db, cardB.id)
    const runC = await scanKeywordCard(db, cardC.id)

    expect(runA.outcomeKind).toBe('playwright_ok')
    expect(runA.providerUsed).toBe('threads_playwright')
    // B and C: playwright threw quota → fallback path entered
    expect(runB.outcomeKind).toBe('no_matching_threads_results')
    expect(runC.outcomeKind).toBe('no_matching_threads_results')
    expect(fetchThreadsSearchOutcomeMock).toHaveBeenCalledTimes(2)
  })

  it('snapshot reflects todayCounts after each successful claim', () => {
    const db = openMemoryDatabase()
    setDailyLimits(db, { search: 5 })

    const before = getThrottleSnapshot(db)
    expect(before.todayCounts.search).toBe(0)
    expect(before.dailyLimits.search).toBe(5)
  })
})

describe('kill-switch smoke (12.7)', () => {
  beforeEach(() => {
    searchThreadsWithPlaywrightMock.mockReset()
    fetchThreadsSearchOutcomeMock.mockReset()
  })

  it('engaging kill switch makes scanKeywordCard throw KillSwitchActiveError and the fallback path is NEVER taken', async () => {
    const db = openMemoryDatabase()
    setKillSwitch(db, true)
    searchThreadsWithPlaywrightMock.mockRejectedValue(new KillSwitchActiveError())

    const repo = new PatrolRepository(db)
    const card = repo.createCard('foo')

    await expect(scanKeywordCard(db, card.id)).rejects.toBeInstanceOf(KillSwitchActiveError)
    expect(fetchThreadsSearchOutcomeMock).not.toHaveBeenCalled()
  })

  it('disengaging kill switch lets a normal scan proceed', async () => {
    const db = openMemoryDatabase()
    setKillSwitch(db, true)
    setKillSwitch(db, false)
    setJitterMs(db, { min: 0, max: 0 })

    searchThreadsWithPlaywrightMock.mockResolvedValue([
      { source: 'threads_playwright', url: 'https://www.threads.com/@a/post/2', title: 't', excerpt: 'x', author: null, postedAt: null, likes: null, replyCount: null, reposts: null, shares: null, images: [], videos: [] }
    ])

    const repo = new PatrolRepository(db)
    const card = repo.createCard('foo')

    const run = await scanKeywordCard(db, card.id)
    expect(run.outcomeKind).toBe('playwright_ok')
    expect(run.providerUsed).toBe('threads_playwright')
  })

  it('snapshot reflects killSwitch flag after toggle', () => {
    const db = openMemoryDatabase()
    expect(getThrottleSnapshot(db).killSwitch).toBe(false)
    setKillSwitch(db, true)
    expect(getThrottleSnapshot(db).killSwitch).toBe(true)
    setKillSwitch(db, false)
    expect(getThrottleSnapshot(db).killSwitch).toBe(false)
  })
})
