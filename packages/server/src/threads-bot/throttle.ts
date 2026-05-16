import type { AppDatabase } from '../db.js'

export type ThrottleOp = 'search' | 'publish' | 'reply'

export class KillSwitchActiveError extends Error {
  readonly code = 'KILL_SWITCH_ACTIVE'
  constructor() {
    super('Threads kill switch 已啟用，暫停 Threads 海巡。')
    this.name = 'KillSwitchActiveError'
  }
}

export class DailyQuotaExceededError extends Error {
  readonly code = 'DAILY_QUOTA_EXCEEDED'
  readonly op: ThrottleOp
  readonly limit: number
  constructor(op: ThrottleOp, limit: number) {
    super(`Threads ${op} 每日上限 ${limit} 次已用完。`)
    this.name = 'DailyQuotaExceededError'
    this.op = op
    this.limit = limit
  }
}

const SETTING_KILL_SWITCH = 'threads.killSwitch'
const SETTING_DAILY_LIMITS = 'threads.dailyLimits'
const SETTING_JITTER_MS = 'threads.jitterMs'

const DEFAULT_DAILY_LIMITS: Record<ThrottleOp, number> = { search: 2_000, publish: 3, reply: 10 }
const DEFAULT_JITTER_MS = { min: 5_000, max: 30_000 }

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

function readSetting<T extends JsonValue>(db: AppDatabase, key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

function writeSetting(db: AppDatabase, key: string, value: JsonValue) {
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString())
}

export function getKillSwitch(db: AppDatabase): boolean {
  return readSetting<boolean>(db, SETTING_KILL_SWITCH, false)
}

export function setKillSwitch(db: AppDatabase, on: boolean) {
  writeSetting(db, SETTING_KILL_SWITCH, on)
}

export function getDailyLimits(db: AppDatabase): Record<ThrottleOp, number> {
  const stored = readSetting<Record<string, number>>(db, SETTING_DAILY_LIMITS, DEFAULT_DAILY_LIMITS)
  return {
    search: typeof stored.search === 'number' ? stored.search : DEFAULT_DAILY_LIMITS.search,
    publish: typeof stored.publish === 'number' ? stored.publish : DEFAULT_DAILY_LIMITS.publish,
    reply: typeof stored.reply === 'number' ? stored.reply : DEFAULT_DAILY_LIMITS.reply
  }
}

export function setDailyLimits(db: AppDatabase, limits: Partial<Record<ThrottleOp, number>>) {
  const current = getDailyLimits(db)
  writeSetting(db, SETTING_DAILY_LIMITS, { ...current, ...limits })
}

export function getJitterMs(db: AppDatabase): { min: number; max: number } {
  const stored = readSetting<{ min: number; max: number }>(db, SETTING_JITTER_MS, DEFAULT_JITTER_MS)
  return {
    min: typeof stored.min === 'number' && stored.min >= 0 ? stored.min : DEFAULT_JITTER_MS.min,
    max: typeof stored.max === 'number' && stored.max >= 0 ? stored.max : DEFAULT_JITTER_MS.max
  }
}

export function setJitterMs(db: AppDatabase, jitter: { min: number; max: number }) {
  writeSetting(db, SETTING_JITTER_MS, jitter)
}

function todayInTaipei(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

export function getTodayCount(db: AppDatabase, op: ThrottleOp, now = new Date()): number {
  const row = db.prepare('SELECT count FROM daily_quotas WHERE op = ? AND date = ?').get(op, todayInTaipei(now)) as { count: number } | undefined
  return row?.count ?? 0
}

export function resetTodayCount(db: AppDatabase, op: ThrottleOp, now = new Date()): number {
  const result = db.prepare('DELETE FROM daily_quotas WHERE op = ? AND date = ?').run(op, todayInTaipei(now))
  return result.changes
}

function claimQuota(db: AppDatabase, op: ThrottleOp, limit: number, now: Date): boolean {
  if (limit <= 0) return false
  const result = db.prepare(`
    INSERT INTO daily_quotas (op, date, count) VALUES (?, ?, 1)
    ON CONFLICT(op, date) DO UPDATE SET count = count + 1 WHERE count < ?
  `).run(op, todayInTaipei(now), limit)
  return result.changes > 0
}

export type GateOptions = {
  now?: Date
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function gate(db: AppDatabase, op: ThrottleOp, options: GateOptions = {}): Promise<void> {
  if (getKillSwitch(db)) throw new KillSwitchActiveError()
  const now = options.now ?? new Date()
  const limits = getDailyLimits(db)
  const limit = limits[op] ?? 0
  if (!claimQuota(db, op, limit, now)) throw new DailyQuotaExceededError(op, limit)
  const jitter = getJitterMs(db)
  if (jitter.max > 0 && jitter.max >= jitter.min) {
    const random = options.random ?? Math.random
    const span = Math.max(0, jitter.max - jitter.min)
    const ms = Math.floor(jitter.min + random() * span)
    const sleep = options.sleep ?? defaultSleep
    await sleep(ms)
  }
}

export type ThrottleSnapshot = {
  killSwitch: boolean
  dailyLimits: Record<ThrottleOp, number>
  jitterMs: { min: number; max: number }
  todayCounts: Record<ThrottleOp, number>
  date: string
}

export function getThrottleSnapshot(db: AppDatabase, now = new Date()): ThrottleSnapshot {
  return {
    killSwitch: getKillSwitch(db),
    dailyLimits: getDailyLimits(db),
    jitterMs: getJitterMs(db),
    todayCounts: {
      search: getTodayCount(db, 'search', now),
      publish: getTodayCount(db, 'publish', now),
      reply: getTodayCount(db, 'reply', now)
    },
    date: todayInTaipei(now)
  }
}
