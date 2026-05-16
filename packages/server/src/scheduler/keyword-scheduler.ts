import cron, { type ScheduledTask } from 'node-cron'
import type { AppDatabase } from '../db.js'
import { scanKeywordCard } from '../keyword-scan.js'
import { PatrolRepository } from '../repository.js'
import { DailyQuotaExceededError, getThrottleSnapshot, KillSwitchActiveError } from '../threads-bot/throttle.js'
import { nowIso } from '../time.js'
import type { PatrolCard } from '../types.js'

export type KeywordSchedulerStatus = {
  enabled: boolean
  cadence: string
  running: boolean
  nextRunAt: string | null
  lastStatus: 'idle' | 'running' | 'completed' | 'failed' | 'skipped_overlap'
  lastStartedAt: string | null
  lastCompletedAt: string | null
  lastSkippedAt: string | null
  lastError: string | null
  lastCardCount: number
  lastEligibleCount: number
  lastInsertedCount: number
  lastQuotaRemaining: number | null
  lastScannedKeywords: string[]
  maxCardsPerTick: number
  minIntervalMinutes: number
}

const DEFAULT_CADENCE = process.env.AUTO_SOCIAL_KEYWORD_SCAN_CRON?.trim() || '*/15 * * * *'
const DEFAULT_MAX_CARDS_PER_TICK = readPositiveInt(process.env.AUTO_SOCIAL_KEYWORD_SCAN_MAX_PER_TICK, 2)
const DEFAULT_MIN_INTERVAL_MINUTES = readPositiveInt(process.env.AUTO_SOCIAL_KEYWORD_SCAN_MIN_INTERVAL_MINUTES, 120)

class KeywordScheduler {
  private task: ScheduledTask | null = null
  private status: KeywordSchedulerStatus = {
    enabled: false,
    cadence: DEFAULT_CADENCE,
    running: false,
    nextRunAt: null,
    lastStatus: 'idle',
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSkippedAt: null,
    lastError: null,
    lastCardCount: 0,
    lastEligibleCount: 0,
    lastInsertedCount: 0,
    lastQuotaRemaining: null,
    lastScannedKeywords: [],
    maxCardsPerTick: DEFAULT_MAX_CARDS_PER_TICK,
    minIntervalMinutes: DEFAULT_MIN_INTERVAL_MINUTES
  }

  constructor(private readonly db: AppDatabase) {}

  start() {
    if (this.task) return
    this.status.enabled = true
    this.status.nextRunAt = computeNextRunAt(this.status.cadence)
    this.task = cron.schedule(this.status.cadence, () => {
      void this.runTick()
    }, { timezone: 'Asia/Taipei' })
  }

  getStatus(): KeywordSchedulerStatus {
    return { ...this.status }
  }

  private async runTick() {
    if (this.status.running) {
      this.status.lastStatus = 'skipped_overlap'
      this.status.lastSkippedAt = nowIso()
      this.status.nextRunAt = computeNextRunAt(this.status.cadence)
      return
    }

    this.status.running = true
    this.status.lastStatus = 'running'
    this.status.lastStartedAt = nowIso()
    this.status.lastError = null

    const repo = new PatrolRepository(this.db)
    const allCards = repo.listCards()
    const throttle = getThrottleSnapshot(this.db)
    const quotaRemaining = Math.max(0, throttle.dailyLimits.search - throttle.todayCounts.search)
    const selected = selectCardsForAutoScan(allCards, {
      now: new Date(),
      quotaRemaining,
      maxCardsPerTick: this.status.maxCardsPerTick,
      minIntervalMinutes: this.status.minIntervalMinutes
    })
    this.status.lastCardCount = selected.cards.length
    this.status.lastEligibleCount = selected.eligibleCount
    this.status.lastQuotaRemaining = quotaRemaining
    this.status.lastScannedKeywords = selected.cards.map((card) => card.keyword)
    let insertedCount = 0
    const errors: string[] = []
    const scanId = `keyword-auto:${this.status.lastStartedAt}`
    this.db.prepare(`
      INSERT INTO scan_runs (id, started_at, status, reason, sources_summary_json, errors_json)
      VALUES (?, ?, 'running', 'keyword_auto', ?, ?)
    `).run(scanId, this.status.lastStartedAt, JSON.stringify({
      totalCardCount: allCards.length,
      eligibleCount: selected.eligibleCount,
      selectedCardCount: selected.cards.length,
      selectedCardIds: selected.cards.map((card) => card.id),
      selectedKeywords: selected.cards.map((card) => card.keyword),
      quotaRemaining,
      maxCardsPerTick: this.status.maxCardsPerTick,
      minIntervalMinutes: this.status.minIntervalMinutes
    }), JSON.stringify([]))

    try {
      for (const card of selected.cards) {
        try {
          const run = await scanKeywordCard(this.db, card.id)
          insertedCount += Array.isArray(run.inserted) ? run.inserted.length : 0
        } catch (error) {
          const message = error instanceof Error ? error.message : 'keyword auto scan failed'
          errors.push(`[${card.keyword}] ${message}`)
          if (error instanceof KillSwitchActiveError || error instanceof DailyQuotaExceededError) break
        }
      }
      this.status.lastInsertedCount = insertedCount
      this.status.lastCompletedAt = nowIso()
      this.status.lastError = errors.length > 0 ? errors.join(' | ') : null
      this.status.lastStatus = errors.length > 0 ? 'failed' : 'completed'
      this.db.prepare(`
        UPDATE scan_runs
        SET ended_at = ?, status = ?, candidates_added = ?, errors_json = ?
        WHERE id = ?
      `).run(this.status.lastCompletedAt, errors.length > 0 ? 'failed' : 'completed', insertedCount, JSON.stringify(errors), scanId)
    } finally {
      this.status.running = false
      this.status.nextRunAt = computeNextRunAt(this.status.cadence)
    }
  }
}

type SelectAutoScanOptions = {
  now: Date
  quotaRemaining: number
  maxCardsPerTick?: number
  minIntervalMinutes?: number
}

export function selectCardsForAutoScan(cards: PatrolCard[], options: SelectAutoScanOptions): { cards: PatrolCard[]; eligibleCount: number } {
  const maxCardsPerTick = Math.max(0, options.maxCardsPerTick ?? DEFAULT_MAX_CARDS_PER_TICK)
  const limit = Math.min(maxCardsPerTick, Math.max(0, options.quotaRemaining))
  if (limit <= 0) return { cards: [], eligibleCount: 0 }

  const minIntervalMs = Math.max(0, options.minIntervalMinutes ?? DEFAULT_MIN_INTERVAL_MINUTES) * 60 * 1000
  const cutoff = options.now.getTime() - minIntervalMs
  const eligible = cards
    .filter((card) => !card.lastScanAt || Date.parse(card.lastScanAt) <= cutoff)
    .sort((a, b) => getScanPriority(a) - getScanPriority(b))

  return { cards: eligible.slice(0, limit), eligibleCount: eligible.length }
}

function getScanPriority(card: PatrolCard): number {
  if (!card.lastScanAt) return 0
  const parsed = Date.parse(card.lastScanAt)
  return Number.isFinite(parsed) ? parsed : 0
}

let schedulerInstance: KeywordScheduler | null = null

export function startKeywordScheduler(db: AppDatabase) {
  if (!schedulerInstance) schedulerInstance = new KeywordScheduler(db)
  schedulerInstance.start()
  return schedulerInstance
}

export function getKeywordSchedulerStatus(): KeywordSchedulerStatus {
  return schedulerInstance?.getStatus() ?? {
    enabled: false,
    cadence: DEFAULT_CADENCE,
    running: false,
    nextRunAt: null,
    lastStatus: 'idle',
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSkippedAt: null,
    lastError: null,
    lastCardCount: 0,
    lastEligibleCount: 0,
    lastInsertedCount: 0,
    lastQuotaRemaining: null,
    lastScannedKeywords: [],
    maxCardsPerTick: DEFAULT_MAX_CARDS_PER_TICK,
    minIntervalMinutes: DEFAULT_MIN_INTERVAL_MINUTES
  }
}

export function computeNextRunAt(cadence: string, now = new Date()): string | null {
  const match = cadence.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/)
  if (!match || !match[1]) return null
  const intervalMinutes = Number(match[1])
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0 || intervalMinutes > 60) return null
  const next = new Date(now)
  next.setSeconds(0, 0)
  const currentMinute = next.getMinutes()
  const nextMinute = Math.floor(currentMinute / intervalMinutes) * intervalMinutes + intervalMinutes
  if (nextMinute >= 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0)
  } else {
    next.setMinutes(nextMinute, 0, 0)
  }
  return next.toISOString()
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
