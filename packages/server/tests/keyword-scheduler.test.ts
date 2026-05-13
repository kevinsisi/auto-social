import { describe, expect, it } from 'vitest'
import { computeNextRunAt } from '../src/scheduler/keyword-scheduler.js'

describe('computeNextRunAt', () => {
  it('computes the next quarter-hour boundary for */15 cadence', () => {
    expect(computeNextRunAt('*/15 * * * *', new Date('2026-05-13T14:07:31.000Z'))).toBe('2026-05-13T14:15:00.000Z')
    expect(computeNextRunAt('*/15 * * * *', new Date('2026-05-13T14:59:31.000Z'))).toBe('2026-05-13T15:00:00.000Z')
  })

  it('returns null for unsupported cron shapes', () => {
    expect(computeNextRunAt('0 */4 * * *')).toBeNull()
  })
})
