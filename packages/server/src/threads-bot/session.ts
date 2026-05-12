import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { AppDatabase } from '../db.js'
import { nowIso } from '../time.js'

export type ThreadsSessionStatus = {
  configured: boolean
  hasSession: boolean
  healthy: boolean
  boundHandle: string | null
  lastLoginAt: string | null
  healthNote: string | null
}

type SessionRow = {
  storage_state_ciphertext: Buffer
  salt: Buffer
  iv: Buffer
  auth_tag: Buffer
  bound_handle: string | null
  last_login_at: string
  healthy: 0 | 1
  health_note: string | null
}

const SESSION_ROW_ID = 1
const KEY_BYTES = 32

export function getThreadsSessionStatus(db: AppDatabase): ThreadsSessionStatus {
  const row = getSessionRow(db)
  return {
    configured: getSessionKey() !== null,
    hasSession: row !== null,
    healthy: row?.healthy === 1,
    boundHandle: row?.bound_handle ?? null,
    lastLoginAt: row?.last_login_at ?? null,
    healthNote: row?.health_note ?? null
  }
}

export function clearThreadsSession(db: AppDatabase) {
  db.prepare('DELETE FROM threads_session WHERE id = ?').run(SESSION_ROW_ID)
}

export function markThreadsSessionUnhealthy(db: AppDatabase, reason: string) {
  db.prepare('UPDATE threads_session SET healthy = 0, health_note = ? WHERE id = ?').run(reason, SESSION_ROW_ID)
}

export function saveThreadsStorageState(db: AppDatabase, storageStateJson: string, boundHandle: string | null) {
  const key = requireSessionKey()
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const derivedKey = deriveSessionKey(key, salt)
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv)
  const ciphertext = Buffer.concat([cipher.update(storageStateJson, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  db.prepare(`
    INSERT OR REPLACE INTO threads_session
      (id, storage_state_ciphertext, salt, iv, auth_tag, bound_handle, last_login_at, healthy, health_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)
  `).run(SESSION_ROW_ID, ciphertext, salt, iv, authTag, boundHandle, nowIso())
}

export function loadThreadsStorageState(db: AppDatabase): string | null {
  const row = getSessionRow(db)
  if (!row) return null
  const key = requireSessionKey()
  const decipher = createDecipheriv('aes-256-gcm', deriveSessionKey(key, row.salt), row.iv)
  decipher.setAuthTag(row.auth_tag)
  return Buffer.concat([decipher.update(row.storage_state_ciphertext), decipher.final()]).toString('utf8')
}

function getSessionRow(db: AppDatabase): SessionRow | null {
  return (db.prepare('SELECT * FROM threads_session WHERE id = ?').get(SESSION_ROW_ID) as SessionRow | undefined) ?? null
}

function getSessionKey() {
  const value = process.env.AUTO_SOCIAL_SESSION_KEY?.trim()
  return value ? value : null
}

function requireSessionKey() {
  const key = getSessionKey()
  if (!key) throw new Error('AUTO_SOCIAL_SESSION_KEY 未設定，不能讀寫 Threads session。')
  return key
}

function deriveSessionKey(key: string, salt: Buffer) {
  const raw = /^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, 'hex') : Buffer.from(key, 'utf8')
  if (raw.length === KEY_BYTES) return raw
  return createHash('sha256').update(salt).update(raw).digest()
}
