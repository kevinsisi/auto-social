import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { createConfirmedReplyAttempt, getLatestReplyAttempt } from '../src/reply-attempts.js'
import { PatrolRepository } from '../src/repository.js'
import { saveThreadsStorageState } from '../src/threads-bot/session.js'
import { setDailyLimits, setKillSwitch } from '../src/threads-bot/throttle.js'
import { nowIso } from '../src/time.js'

const originalSessionKey = process.env.AUTO_SOCIAL_SESSION_KEY
const originalReplyEnabled = process.env.AUTO_SOCIAL_THREADS_REPLY_ENABLED

afterEach(() => {
  process.env.AUTO_SOCIAL_SESSION_KEY = originalSessionKey
  process.env.AUTO_SOCIAL_THREADS_REPLY_ENABLED = originalReplyEnabled
})

function freshDb() {
  process.env.AUTO_SOCIAL_SESSION_KEY = 'd'.repeat(64)
  process.env.AUTO_SOCIAL_THREADS_REPLY_ENABLED = '1'
  const db = openMemoryDatabase()
  saveThreadsStorageState(db, JSON.stringify({ cookies: [], origins: [] }), '@kevin')
  return db
}

function seedCandidate(db: ReturnType<typeof openMemoryDatabase>, cardId: string, url = 'https://www.threads.com/@u/post/abc') {
  db.prepare(`
    INSERT INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, fetched_at, pipeline_status)
    VALUES ('cand-1', 'threads_playwright', 'ext-1', 'fp-1', ?, 0, ?, '@u', 't', 'x', ?, 'drafted')
  `).run(cardId, url, nowIso())
  return 'cand-1'
}

describe('createConfirmedReplyAttempt', () => {
  it('rejects by default unless reply automation is explicitly enabled', () => {
    process.env.AUTO_SOCIAL_SESSION_KEY = 'd'.repeat(64)
    delete process.env.AUTO_SOCIAL_THREADS_REPLY_ENABLED
    const db = openMemoryDatabase()
    saveThreadsStorageState(db, JSON.stringify({ cookies: [], origins: [] }), '@kevin')
    const card = new PatrolRepository(db).createCard('Urus')
    const candidateId = seedCandidate(db, card.id)

    expect(() => createConfirmedReplyAttempt(db, { cardId: card.id, candidateId, text: 'hi', confirm: true })).toThrow('留言自動化目前已停用')
  })

  it('creates a persisted pending attempt and one queue task after explicit confirmation', () => {
    const db = freshDb()
    const card = new PatrolRepository(db).createCard('Urus')
    const candidateId = seedCandidate(db, card.id)

    const attempt = createConfirmedReplyAttempt(db, { cardId: card.id, candidateId, text: '這段我有同感', confirm: true })

    expect(attempt).toMatchObject({ cardId: card.id, candidateId, status: 'pending', boundHandle: '@kevin', replyText: '這段我有同感' })
    expect(attempt.taskId).toBeTruthy()
    expect(getLatestReplyAttempt(db, candidateId)?.id).toBe(attempt.id)
    const taskCount = (db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE type = 'threads_reply' AND status = 'pending'").get() as { n: number }).n
    expect(taskCount).toBe(1)
  })

  it('rejects requests without per-attempt confirmation', () => {
    const db = freshDb()
    const card = new PatrolRepository(db).createCard('Urus')
    const candidateId = seedCandidate(db, card.id)

    expect(() => createConfirmedReplyAttempt(db, { cardId: card.id, candidateId, text: 'hi', confirm: false })).toThrow('逐則確認')
    const attemptCount = (db.prepare('SELECT COUNT(*) AS n FROM reply_attempts').get() as { n: number }).n
    expect(attemptCount).toBe(0)
  })

  it('rejects duplicate attempts after a succeeded reply', () => {
    const db = freshDb()
    const card = new PatrolRepository(db).createCard('Urus')
    const candidateId = seedCandidate(db, card.id)
    const attempt = createConfirmedReplyAttempt(db, { cardId: card.id, candidateId, text: 'first', confirm: true })
    db.prepare("UPDATE reply_attempts SET status = 'succeeded', completed_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), attempt.id)

    expect(() => createConfirmedReplyAttempt(db, { cardId: card.id, candidateId, text: 'second', confirm: true })).toThrow('已經留言成功')
  })

  it('rejects non-Threads post URLs and candidates from another card', () => {
    const db = freshDb()
    const repo = new PatrolRepository(db)
    const first = repo.createCard('Urus')
    const second = repo.createCard('法拉利')
    const candidateId = seedCandidate(db, first.id, 'https://example.com/post/abc')

    expect(() => createConfirmedReplyAttempt(db, { cardId: first.id, candidateId, text: 'hi', confirm: true })).toThrow('Threads 貼文 URL')
    expect(() => createConfirmedReplyAttempt(db, { cardId: second.id, candidateId, text: 'hi', confirm: true })).toThrow('找不到這則樣本')
  })

  it('rejects kill-switch and exhausted reply quota before enqueueing', () => {
    const db = freshDb()
    const card = new PatrolRepository(db).createCard('Urus')
    const candidateId = seedCandidate(db, card.id)

    setKillSwitch(db, true)
    expect(() => createConfirmedReplyAttempt(db, { cardId: card.id, candidateId, text: 'hi', confirm: true })).toThrow('kill switch')
    setKillSwitch(db, false)
    setDailyLimits(db, { reply: 0 })
    expect(() => createConfirmedReplyAttempt(db, { cardId: card.id, candidateId, text: 'hi', confirm: true })).toThrow('每日上限')
  })
})
