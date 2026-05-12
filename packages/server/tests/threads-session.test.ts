import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { clearThreadsSession, getThreadsSessionStatus, loadThreadsStorageState, saveThreadsStorageState } from '../src/threads-bot/session.js'

const originalSessionKey = process.env.AUTO_SOCIAL_SESSION_KEY

afterEach(() => {
  process.env.AUTO_SOCIAL_SESSION_KEY = originalSessionKey
})

describe('Threads session storage', () => {
  it('reports missing session key and empty session', () => {
    delete process.env.AUTO_SOCIAL_SESSION_KEY
    const db = openMemoryDatabase()

    expect(getThreadsSessionStatus(db)).toMatchObject({ configured: false, hasSession: false })
  })

  it('encrypts and decrypts Playwright storage state', () => {
    process.env.AUTO_SOCIAL_SESSION_KEY = 'a'.repeat(64)
    const db = openMemoryDatabase()
    const state = JSON.stringify({ cookies: [{ name: 'sid', value: 'secret' }], origins: [] })

    saveThreadsStorageState(db, state, '@kevin')

    expect(loadThreadsStorageState(db)).toBe(state)
    expect(getThreadsSessionStatus(db)).toMatchObject({ configured: true, hasSession: true, healthy: true, boundHandle: '@kevin' })
  })

  it('clears saved session rows', () => {
    process.env.AUTO_SOCIAL_SESSION_KEY = 'b'.repeat(64)
    const db = openMemoryDatabase()

    saveThreadsStorageState(db, JSON.stringify({ cookies: [], origins: [] }), null)
    clearThreadsSession(db)

    expect(getThreadsSessionStatus(db).hasSession).toBe(false)
  })
})
