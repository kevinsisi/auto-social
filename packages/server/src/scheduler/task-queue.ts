import { nanoid } from 'nanoid'
import type { AppDatabase } from '../db.js'
import { nowIso } from '../time.js'

export type TaskType = 'pipeline' | 'compose_post' | 'image_gen' | 'threads_reply'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type TaskRow = {
  id: string
  type: TaskType
  label: string
  payload: Record<string, unknown>
  status: TaskStatus
  priority: number
  attempts: number
  maxAttempts: number
  enqueuedAt: string
  claimedAt: string | null
  completedAt: string | null
  result: unknown
  error: string | null
  nextRetryAt: string | null
}

type RawTaskRow = {
  id: string
  type: TaskType
  label: string
  payload_json: string
  status: TaskStatus
  priority: number
  attempts: number
  max_attempts: number
  enqueued_at: string
  claimed_at: string | null
  completed_at: string | null
  result_json: string | null
  error: string | null
  next_retry_at: string | null
}

export type EnqueueOptions = {
  type: TaskType
  label: string
  payload: Record<string, unknown>
  priority?: number
  maxAttempts?: number
  dedupeKey?: string
}

const DEFAULT_PRIORITY: Record<TaskType, number> = {
  pipeline: 5,
  compose_post: 4,
  image_gen: 6,
  threads_reply: 3
}

export function enqueueTask(db: AppDatabase, options: EnqueueOptions): string | null {
  if (options.dedupeKey) {
    const existing = db.prepare(`
      SELECT id FROM ai_tasks
      WHERE type = ? AND status IN ('pending','running')
        AND json_extract(payload_json, '$.dedupeKey') = ?
      LIMIT 1
    `).get(options.type, options.dedupeKey) as { id: string } | undefined
    if (existing) return null
  }
  const id = nanoid()
  const payload = options.dedupeKey
    ? { ...options.payload, dedupeKey: options.dedupeKey }
    : options.payload
  db.prepare(`
    INSERT INTO ai_tasks (id, type, label, payload_json, priority, max_attempts, enqueued_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    options.type,
    options.label,
    JSON.stringify(payload),
    options.priority ?? DEFAULT_PRIORITY[options.type] ?? 5,
    options.maxAttempts ?? 3,
    nowIso()
  )
  return id
}

export function claimNextTask(db: AppDatabase, now: Date = new Date()): TaskRow | null {
  const nowText = now.toISOString()
  const txn = db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM ai_tasks
      WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY priority ASC, enqueued_at ASC
      LIMIT 1
    `).get(nowText) as RawTaskRow | undefined
    if (!row) return null
    db.prepare(`
      UPDATE ai_tasks SET status = 'running', claimed_at = ?, attempts = attempts + 1 WHERE id = ?
    `).run(nowText, row.id)
    return { ...row, status: 'running' as TaskStatus, claimed_at: nowText, attempts: row.attempts + 1 }
  })
  const raw = txn()
  return raw ? mapTaskRow(raw) : null
}

export function completeTask(db: AppDatabase, id: string, result: unknown): void {
  db.prepare(`
    UPDATE ai_tasks SET status = 'completed', completed_at = ?, result_json = ?, error = NULL WHERE id = ?
  `).run(nowIso(), result === undefined ? null : JSON.stringify(result), id)
}

export type FailOptions = {
  message: string
  retryAfterMs?: number
}

export function failTask(db: AppDatabase, id: string, options: FailOptions): void {
  const row = db.prepare('SELECT attempts, max_attempts FROM ai_tasks WHERE id = ?').get(id) as { attempts: number; max_attempts: number } | undefined
  if (!row) return
  const shouldRetry = row.attempts < row.max_attempts && (options.retryAfterMs ?? 0) > 0
  if (shouldRetry) {
    const retryAt = new Date(Date.now() + (options.retryAfterMs ?? 0)).toISOString()
    db.prepare(`
      UPDATE ai_tasks SET status = 'pending', error = ?, next_retry_at = ?, claimed_at = NULL WHERE id = ?
    `).run(options.message, retryAt, id)
  } else {
    db.prepare(`
      UPDATE ai_tasks SET status = 'failed', completed_at = ?, error = ? WHERE id = ?
    `).run(nowIso(), options.message, id)
  }
}

export function cancelTask(db: AppDatabase, id: string): boolean {
  const result = db.prepare(`UPDATE ai_tasks SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('pending','failed')`)
    .run(nowIso(), id)
  return result.changes > 0
}

export function getTask(db: AppDatabase, id: string): TaskRow | null {
  const row = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id) as RawTaskRow | undefined
  return row ? mapTaskRow(row) : null
}

export type QueueSnapshot = {
  countsByType: Record<TaskType, Record<TaskStatus, number>>
  inflight: TaskRow[]
  recent: TaskRow[]
}

export function getQueueSnapshot(db: AppDatabase): QueueSnapshot {
  const counts = db.prepare(`SELECT type, status, COUNT(*) AS n FROM ai_tasks GROUP BY type, status`).all() as Array<{ type: TaskType; status: TaskStatus; n: number }>
  const countsByType: QueueSnapshot['countsByType'] = {
    pipeline: emptyStatusBucket(),
    compose_post: emptyStatusBucket(),
    image_gen: emptyStatusBucket(),
    threads_reply: emptyStatusBucket()
  }
  for (const row of counts) {
    if (!countsByType[row.type]) countsByType[row.type] = emptyStatusBucket()
    countsByType[row.type][row.status] = row.n
  }

  const inflight = (db.prepare(`SELECT * FROM ai_tasks WHERE status = 'running' ORDER BY claimed_at DESC LIMIT 5`).all() as RawTaskRow[]).map(mapTaskRow)
  const recent = (db.prepare(`SELECT * FROM ai_tasks WHERE status IN ('completed','failed','cancelled') ORDER BY completed_at DESC LIMIT 10`).all() as RawTaskRow[]).map(mapTaskRow)
  return { countsByType, inflight, recent }
}

export function reclaimStaleTasks(db: AppDatabase, staleAfterMs = 5 * 60 * 1000, now: Date = new Date()): number {
  const threshold = new Date(now.getTime() - staleAfterMs).toISOString()
  const result = db.prepare(`
    UPDATE ai_tasks
    SET status = 'pending', claimed_at = NULL
    WHERE status = 'running' AND claimed_at <= ?
  `).run(threshold)
  return result.changes
}

function emptyStatusBucket(): Record<TaskStatus, number> {
  return { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }
}

function mapTaskRow(row: RawTaskRow): TaskRow {
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>
  } catch {
    payload = {}
  }
  let result: unknown = null
  if (row.result_json) {
    try { result = JSON.parse(row.result_json) } catch { result = row.result_json }
  }
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    payload,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    enqueuedAt: row.enqueued_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    result,
    error: row.error,
    nextRetryAt: row.next_retry_at
  }
}
