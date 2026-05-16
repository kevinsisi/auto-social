import { describe, expect, it } from 'vitest'
import { computeNextRunAt, selectCardsForAutoScan } from '../src/scheduler/keyword-scheduler.js'
import type { PatrolCard } from '../src/types.js'

describe('computeNextRunAt', () => {
  it('computes the next quarter-hour boundary for */15 cadence', () => {
    expect(computeNextRunAt('*/15 * * * *', new Date('2026-05-13T14:07:31.000Z'))).toBe('2026-05-13T14:15:00.000Z')
    expect(computeNextRunAt('*/15 * * * *', new Date('2026-05-13T14:59:31.000Z'))).toBe('2026-05-13T15:00:00.000Z')
  })

  it('returns null for unsupported cron shapes', () => {
    expect(computeNextRunAt('0 */4 * * *')).toBeNull()
  })
})

describe('selectCardsForAutoScan', () => {
  it('prioritizes unscanned cards and caps each tick by quota and maxCardsPerTick', () => {
    const now = new Date('2026-05-16T10:00:00.000Z')
    const cards = [
      card('recent', '剛掃過', '2026-05-16T09:30:00.000Z'),
      card('old', '很久沒掃', '2026-05-16T06:00:00.000Z'),
      card('new', '新關鍵字', null),
      card('older', '更久沒掃', '2026-05-16T05:00:00.000Z')
    ]

    const selected = selectCardsForAutoScan(cards, { now, quotaRemaining: 10, maxCardsPerTick: 2, minIntervalMinutes: 120 })

    expect(selected.eligibleCount).toBe(3)
    expect(selected.cards.map((item) => item.id)).toEqual(['new', 'older'])
  })

  it('does not select cards when quota is exhausted', () => {
    const selected = selectCardsForAutoScan([
      card('new', '新關鍵字', null)
    ], { now: new Date('2026-05-16T10:00:00.000Z'), quotaRemaining: 0, maxCardsPerTick: 2, minIntervalMinutes: 120 })

    expect(selected).toEqual({ cards: [], eligibleCount: 0 })
  })
})

function card(id: string, keyword: string, lastScanAt: string | null): PatrolCard {
  return {
    id,
    keyword,
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    recentSampleCount: 0,
    lastScanAt
  }
}
