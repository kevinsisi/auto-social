import { nanoid } from 'nanoid'
import type { AppDatabase } from './db.js'
import { enqueueTask } from './scheduler/task-queue.js'
import { nowIso } from './time.js'
import { getDailyLimits, getKillSwitch, getTodayCount } from './threads-bot/throttle.js'
import { getThreadsSessionStatus } from './threads-bot/session.js'
import { performThreadsReply, type ThreadsReplyAutomationResult } from './threads-bot/reply.js'

export type ReplyAttemptStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'uncertain'
export type ReplyVerificationMethod = 'reply_url' | 'dom_match' | null

export type ReplyAttempt = {
  id: string
  cardId: string
  candidateId: string
  taskId: string | null
  targetUrl: string
  replyText: string
  boundHandle: string
  status: ReplyAttemptStatus
  verificationMethod: ReplyVerificationMethod
  replyUrl: string | null
  error: string | null
  screenshotPath: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

type ReplyAttemptRow = {
  id: string
  card_id: string
  candidate_id: string
  task_id: string | null
  target_url: string
  reply_text: string
  bound_handle: string
  status: ReplyAttemptStatus
  verification_method: ReplyVerificationMethod
  reply_url: string | null
  error: string | null
  screenshot_path: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

type CandidateForReply = {
  id: string
  card_id: string
  url: string
  author: string | null
}

export type CreateReplyAttemptInput = {
  cardId: string
  candidateId: string
  text: string
  confirm: boolean
}

export type ThreadsReplyTaskPayload = {
  attemptId: string
}

const MAX_REPLY_TEXT_LENGTH = 500
const REPLY_AUTOMATION_ENABLED = '1'

export function createConfirmedReplyAttempt(db: AppDatabase, input: CreateReplyAttemptInput): ReplyAttempt {
  const replyText = input.text.trim()
  assertThreadsReplyAutomationEnabled()
  if (!input.confirm) throw new Error('必須逐則確認後才能送出 Threads 留言。')
  if (!replyText) throw new Error('留言內容不可為空。')
  if (replyText.length > MAX_REPLY_TEXT_LENGTH) throw new Error(`留言內容不可超過 ${MAX_REPLY_TEXT_LENGTH} 字。`)

  const candidate = getCandidateForReply(db, input.cardId, input.candidateId)
  if (!candidate) throw new Error('找不到這則樣本。')
  if (!isThreadsPostUrl(candidate.url)) throw new Error('只能使用 Threads 貼文 URL 留言。')

  const session = getThreadsSessionStatus(db)
  if (!session.configured) throw new Error('AUTO_SOCIAL_SESSION_KEY 未設定，不能讀寫 Threads session。')
  if (!session.hasSession) throw new Error('尚未匯入 Threads session，請先到 Settings 登入或匯入。')
  if (!session.healthy) throw new Error(session.healthNote ?? 'Threads session 目前不健康，請重新登入。')
  if (!session.boundHandle) throw new Error('Threads session 尚未確認登入帳號，請先在 Settings 執行帳號探測。')
  if (getKillSwitch(db)) throw new Error('Threads kill switch 已啟用，暫停 Threads 留言。')

  const limits = getDailyLimits(db)
  const replyLimit = limits.reply
  if (replyLimit <= 0 || getTodayCount(db, 'reply') >= replyLimit) {
    throw new Error(`Threads reply 每日上限 ${replyLimit} 次已用完。`)
  }

  if (getLatestSucceededReplyAttempt(db, input.candidateId)) {
    throw new Error('這則樣本已經留言成功，為避免重複留言已阻擋。')
  }
  const active = getLatestActiveReplyAttempt(db, input.candidateId)
  if (active) throw new Error('這則樣本已有留言工作進行中，請等待結果。')

  const now = nowIso()
  const attemptId = nanoid()
  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO reply_attempts
        (id, card_id, candidate_id, task_id, target_url, reply_text, bound_handle, status, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, 'pending', ?, ?)
    `).run(attemptId, candidate.card_id, candidate.id, candidate.url, replyText, session.boundHandle, now, now)
    const taskId = enqueueTask(db, {
      type: 'threads_reply',
      label: `Threads reply ${candidate.author ?? candidate.id}`,
      payload: { attemptId },
      priority: 3,
      maxAttempts: 1,
      dedupeKey: `threads-reply:${candidate.id}`
    })
    if (!taskId) throw new Error('這則樣本已有留言工作進行中，請等待結果。')
    db.prepare('UPDATE reply_attempts SET task_id = ? WHERE id = ?').run(taskId, attemptId)
  })
  txn()

  return getReplyAttempt(db, attemptId)!
}

export function getReplyAttempt(db: AppDatabase, id: string): ReplyAttempt | null {
  const row = db.prepare('SELECT * FROM reply_attempts WHERE id = ?').get(id) as ReplyAttemptRow | undefined
  return row ? mapReplyAttempt(row) : null
}

export function getLatestReplyAttempt(db: AppDatabase, candidateId: string): ReplyAttempt | null {
  const row = db.prepare('SELECT * FROM reply_attempts WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1').get(candidateId) as ReplyAttemptRow | undefined
  return row ? mapReplyAttempt(row) : null
}

export function listLatestReplyAttempts(db: AppDatabase, candidateIds: string[]): Map<string, ReplyAttempt> {
  if (candidateIds.length === 0) return new Map()
  const placeholders = candidateIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT ra.*
    FROM reply_attempts ra
    JOIN (
      SELECT candidate_id, MAX(created_at) AS latest_created_at
      FROM reply_attempts
      WHERE candidate_id IN (${placeholders})
      GROUP BY candidate_id
    ) latest ON latest.candidate_id = ra.candidate_id AND latest.latest_created_at = ra.created_at
  `).all(...candidateIds) as ReplyAttemptRow[]
  return new Map(rows.map((row) => [row.candidate_id, mapReplyAttempt(row)]))
}

export function markReplyAttemptRunning(db: AppDatabase, attemptId: string) {
  const now = nowIso()
  db.prepare(`
    UPDATE reply_attempts
    SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, error = NULL
    WHERE id = ? AND status = 'pending'
  `).run(now, now, attemptId)
}

export function completeReplyAttempt(db: AppDatabase, attemptId: string, result: ThreadsReplyAutomationResult): ReplyAttempt | null {
  const now = nowIso()
  const status: ReplyAttemptStatus = result.status
  db.prepare(`
    UPDATE reply_attempts
    SET status = ?, verification_method = ?, reply_url = ?, error = ?, screenshot_path = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    result.verificationMethod ?? null,
    result.replyUrl ?? null,
    result.error ?? null,
    result.screenshotPath ?? null,
    now,
    now,
    attemptId
  )
  return getReplyAttempt(db, attemptId)
}

export async function threadsReplyTaskHandler(db: AppDatabase, payload: ThreadsReplyTaskPayload) {
  if (!payload.attemptId) throw new Error('threads_reply task missing attemptId')
  const attempt = getReplyAttempt(db, payload.attemptId)
  if (!attempt) throw new Error('找不到留言工作。')
  if (attempt.status === 'succeeded' || attempt.status === 'failed' || attempt.status === 'uncertain') return attempt

  markReplyAttemptRunning(db, attempt.id)
  let result: ThreadsReplyAutomationResult
  try {
    assertThreadsReplyAutomationEnabled()
    result = await performThreadsReply(db, {
      attemptId: attempt.id,
      targetUrl: attempt.targetUrl,
      replyText: attempt.replyText,
      boundHandle: attempt.boundHandle
    })
  } catch (error) {
    result = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
  return completeReplyAttempt(db, attempt.id, result)
}

function assertThreadsReplyAutomationEnabled() {
  if (process.env.AUTO_SOCIAL_THREADS_REPLY_ENABLED !== REPLY_AUTOMATION_ENABLED) {
    throw new Error('Threads 留言自動化目前已停用。需設定 AUTO_SOCIAL_THREADS_REPLY_ENABLED=1 才能啟用。')
  }
}

function getCandidateForReply(db: AppDatabase, cardId: string, candidateId: string): CandidateForReply | null {
  return (db.prepare(`
    SELECT id, card_id, url, author
    FROM trend_candidates
    WHERE card_id = ? AND id = ?
  `).get(cardId, candidateId) as CandidateForReply | undefined) ?? null
}

function getLatestSucceededReplyAttempt(db: AppDatabase, candidateId: string): ReplyAttempt | null {
  const row = db.prepare(`
    SELECT * FROM reply_attempts WHERE candidate_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1
  `).get(candidateId) as ReplyAttemptRow | undefined
  return row ? mapReplyAttempt(row) : null
}

function getLatestActiveReplyAttempt(db: AppDatabase, candidateId: string): ReplyAttempt | null {
  const row = db.prepare(`
    SELECT * FROM reply_attempts WHERE candidate_id = ? AND status IN ('pending', 'running') ORDER BY created_at DESC LIMIT 1
  `).get(candidateId) as ReplyAttemptRow | undefined
  return row ? mapReplyAttempt(row) : null
}

function isThreadsPostUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return /^(.+\.)?threads\.(net|com)$/i.test(url.hostname) && /\/post\//i.test(url.pathname)
  } catch {
    return false
  }
}

function mapReplyAttempt(row: ReplyAttemptRow): ReplyAttempt {
  return {
    id: row.id,
    cardId: row.card_id,
    candidateId: row.candidate_id,
    taskId: row.task_id,
    targetUrl: row.target_url,
    replyText: row.reply_text,
    boundHandle: row.bound_handle,
    status: row.status,
    verificationMethod: row.verification_method,
    replyUrl: row.reply_url,
    error: row.error,
    screenshotPath: row.screenshot_path,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  }
}
