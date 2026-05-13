import { describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import {
  DailyQuotaExceededError,
  KillSwitchActiveError,
  gate,
  getKillSwitch,
  getThrottleSnapshot,
  getTodayCount,
  setDailyLimits,
  setJitterMs,
  setKillSwitch
} from '../src/threads-bot/throttle.js'

const noJitter = { sleep: vi.fn().mockResolvedValue(undefined) }

function freshDb() {
  const db = openMemoryDatabase()
  setJitterMs(db, { min: 0, max: 0 })
  return db
}

describe('gate', () => {
  it('passes when kill switch is off and quota is fresh, and increments the counter', async () => {
    const db = freshDb()

    await gate(db, 'search', noJitter)

    expect(getTodayCount(db, 'search')).toBe(1)
    expect(noJitter.sleep).not.toHaveBeenCalled()
  })

  it('throws KillSwitchActiveError when kill switch is on', async () => {
    const db = freshDb()
    setKillSwitch(db, true)

    await expect(gate(db, 'search', noJitter)).rejects.toBeInstanceOf(KillSwitchActiveError)
    expect(getTodayCount(db, 'search')).toBe(0)
  })

  it('throws DailyQuotaExceededError once the daily limit is reached', async () => {
    const db = freshDb()
    setDailyLimits(db, { search: 2 })

    await gate(db, 'search', noJitter)
    await gate(db, 'search', noJitter)

    await expect(gate(db, 'search', noJitter)).rejects.toBeInstanceOf(DailyQuotaExceededError)
    expect(getTodayCount(db, 'search')).toBe(2)
  })

  it('throws DailyQuotaExceededError immediately when limit is zero', async () => {
    const db = freshDb()
    setDailyLimits(db, { publish: 0 })

    await expect(gate(db, 'publish', noJitter)).rejects.toBeInstanceOf(DailyQuotaExceededError)
    expect(getTodayCount(db, 'publish')).toBe(0)
  })

  it('applies jitter between min and max using injected random', async () => {
    const db = openMemoryDatabase()
    setJitterMs(db, { min: 5_000, max: 15_000 })
    const sleep = vi.fn().mockResolvedValue(undefined)
    const random = vi.fn().mockReturnValue(0.5)

    await gate(db, 'search', { sleep, random })

    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0]?.[0]).toBe(10_000)
  })

  it('separates quotas per op', async () => {
    const db = freshDb()
    setDailyLimits(db, { search: 1, publish: 1, reply: 1 })

    await gate(db, 'search', noJitter)

    await expect(gate(db, 'search', noJitter)).rejects.toBeInstanceOf(DailyQuotaExceededError)
    await expect(gate(db, 'publish', noJitter)).resolves.toBeUndefined()
    await expect(gate(db, 'reply', noJitter)).resolves.toBeUndefined()
  })
})

describe('setKillSwitch / getKillSwitch', () => {
  it('round-trips the kill switch state', () => {
    const db = openMemoryDatabase()
    expect(getKillSwitch(db)).toBe(false)

    setKillSwitch(db, true)
    expect(getKillSwitch(db)).toBe(true)

    setKillSwitch(db, false)
    expect(getKillSwitch(db)).toBe(false)
  })
})

describe('getThrottleSnapshot', () => {
  it('returns settings, limits, and today counts in one read', async () => {
    const db = freshDb()
    setDailyLimits(db, { search: 5, publish: 1, reply: 2 })
    await gate(db, 'search', noJitter)
    await gate(db, 'search', noJitter)

    const snapshot = getThrottleSnapshot(db)

    expect(snapshot.killSwitch).toBe(false)
    expect(snapshot.dailyLimits.search).toBe(5)
    expect(snapshot.dailyLimits.publish).toBe(1)
    expect(snapshot.dailyLimits.reply).toBe(2)
    expect(snapshot.todayCounts.search).toBe(2)
    expect(snapshot.todayCounts.publish).toBe(0)
    expect(snapshot.todayCounts.reply).toBe(0)
    expect(snapshot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
