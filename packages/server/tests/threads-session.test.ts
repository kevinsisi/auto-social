import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { clearThreadsSession, getThreadsSessionStatus, importThreadsStorageState, loadThreadsStorageState, saveThreadsStorageState } from '../src/threads-bot/session.js'

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

  it('imports storageState JSON and rejects malformed payloads', () => {
    process.env.AUTO_SOCIAL_SESSION_KEY = 'c'.repeat(64)
    const db = openMemoryDatabase()
    const state = JSON.stringify({ cookies: [{ domain: '.threads.net', name: 'sid', value: 'secret' }], origins: [] })

    const status = importThreadsStorageState(db, state)

    expect(status.hasSession).toBe(true)
    expect(loadThreadsStorageState(db)).toBe(state)
    expect(() => importThreadsStorageState(db, JSON.stringify({ cookies: [] }))).toThrow('storageState JSON 格式不正確')
  })
})
