import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { scanKeywordCard } from '../src/keyword-scan.js'
import { PatrolRepository } from '../src/repository.js'
import {
  getThrottleSnapshot,
  setDailyLimits,
  setKillSwitch
} from '../src/threads-bot/throttle.js'

const fetchThreadsSearchOutcomeMock = vi.hoisted(() => vi.fn())

vi.mock('../src/sources/threads-search.js', () => ({
  fetchThreadsSearchOutcome: fetchThreadsSearchOutcomeMock
}))

describe('quota smoke (12.6)', () => {
  beforeEach(() => {
    fetchThreadsSearchOutcomeMock.mockReset()
  })

  it('uses search-engine fallback without consuming Threads Playwright search quota', async () => {
    const db = openMemoryDatabase()
    setDailyLimits(db, { search: 1 })
    fetchThreadsSearchOutcomeMock.mockResolvedValue({ candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] })

    const repo = new PatrolRepository(db)
    const cardA = repo.createCard('foo')
    const cardB = repo.createCard('bar')
    const cardC = repo.createCard('baz')

    const runA = await scanKeywordCard(db, cardA.id)
    const runB = await scanKeywordCard(db, cardB.id)
    const runC = await scanKeywordCard(db, cardC.id)

    expect(runA.outcomeKind).toBe('no_matching_threads_results')
    expect(runB.outcomeKind).toBe('no_matching_threads_results')
    expect(runC.outcomeKind).toBe('no_matching_threads_results')
    expect(fetchThreadsSearchOutcomeMock).toHaveBeenCalledTimes(3)
    expect(getThrottleSnapshot(db).todayCounts.search).toBe(0)
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
    fetchThreadsSearchOutcomeMock.mockReset()
  })

  it('engaging kill switch does not start Threads Playwright because scan uses search-engine fallback only', async () => {
    const db = openMemoryDatabase()
    setKillSwitch(db, true)
    fetchThreadsSearchOutcomeMock.mockResolvedValue({ candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] })

    const repo = new PatrolRepository(db)
    const card = repo.createCard('foo')

    const run = await scanKeywordCard(db, card.id)

    expect(run.outcomeKind).toBe('no_matching_threads_results')
    expect(fetchThreadsSearchOutcomeMock).toHaveBeenCalledWith('foo')
  })

  it('disengaging kill switch lets a normal scan proceed', async () => {
    const db = openMemoryDatabase()
    setKillSwitch(db, true)
    setKillSwitch(db, false)
    fetchThreadsSearchOutcomeMock.mockResolvedValue({
      candidates: [{ source: 'threads_search', url: 'https://www.threads.com/@a/post/2', title: 't', excerpt: 'x' }],
      status: 'ok',
      providerUsed: 'bing',
      blockedProviders: []
    })

    const repo = new PatrolRepository(db)
    const card = repo.createCard('foo')

    const run = await scanKeywordCard(db, card.id)
    expect(run.outcomeKind).toBe('fallback_ok')
    expect(run.providerUsed).toBe('bing')
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
