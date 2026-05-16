import { afterEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { performThreadsReply, type ThreadsReplyInput } from '../src/threads-bot/reply.js'
import { getThreadsSessionStatus, saveThreadsStorageState } from '../src/threads-bot/session.js'
import { DailyQuotaExceededError, KillSwitchActiveError, setDailyLimits, setJitterMs, setKillSwitch } from '../src/threads-bot/throttle.js'

const input: ThreadsReplyInput = {
  attemptId: 'attempt-1',
  targetUrl: 'https://www.threads.com/@u/post/abc',
  replyText: '這段我有同感',
  boundHandle: '@kevin'
}

const originalSessionKey = process.env.AUTO_SOCIAL_SESSION_KEY

afterEach(() => {
  process.env.AUTO_SOCIAL_SESSION_KEY = originalSessionKey
})

type FakePageOptions = {
  url?: string
  visibleSelectors?: Set<string>
  verifyResults?: Array<{ replyUrl: string | null; domMatch: boolean }>
}

function fakeDeps(options: FakePageOptions = {}) {
  const visible = options.visibleSelectors ?? new Set([
    'div[role="button"][aria-label*="回覆"]',
    '[contenteditable="true"][role="textbox"]',
    'div[role="button"]:has-text("發布")'
  ])
  const verifyResults = [...(options.verifyResults ?? [{ replyUrl: null, domMatch: true }])]
  const clicks: string[] = []
  const fills: string[] = []
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue(options.url ?? input.targetUrl),
    locator: vi.fn((selector: string) => {
      const count = visible.has(selector) ? 1 : 0
      const makeLocator = () => ({
        count: vi.fn().mockResolvedValue(count),
        isVisible: vi.fn().mockResolvedValue(count > 0),
        click: vi.fn().mockImplementation(async () => { clicks.push(selector) }),
        fill: vi.fn().mockImplementation(async (text: string) => { fills.push(text) })
      })
      return {
        count: vi.fn().mockResolvedValue(count),
        nth: vi.fn(() => makeLocator()),
        last: vi.fn(() => makeLocator())
      }
    }),
    evaluate: vi.fn().mockImplementation(async () => verifyResults.shift() ?? { replyUrl: null, domMatch: false }),
    reload: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png'))
  }
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined)
  }
  return {
    clicks,
    fills,
    page,
    context,
    deps: {
      gate: vi.fn().mockResolvedValue(undefined),
      createContext: vi.fn().mockResolvedValue(context),
      markSessionUnhealthy: vi.fn()
    }
  }
}

describe('performThreadsReply', () => {
  it('submits text and marks success when a reply URL is verified', async () => {
    const db = openMemoryDatabase()
    const fake = fakeDeps({ verifyResults: [{ replyUrl: 'https://www.threads.com/@kevin/post/reply', domMatch: true }] })

    const result = await performThreadsReply(db, input, fake.deps)

    expect(fake.deps.gate).toHaveBeenCalledWith(db, 'reply')
    expect(fake.fills).toEqual([input.replyText])
    expect(fake.clicks).toContain('div[role="button"]:has-text("發布")')
    expect(result).toMatchObject({ status: 'succeeded', verificationMethod: 'reply_url', replyUrl: 'https://www.threads.com/@kevin/post/reply' })
  })

  it('marks the session unhealthy when Threads redirects to login', async () => {
    process.env.AUTO_SOCIAL_SESSION_KEY = 'e'.repeat(64)
    const db = openMemoryDatabase()
    saveThreadsStorageState(db, JSON.stringify({ cookies: [], origins: [] }), '@kevin')
    const fake = fakeDeps({ url: 'https://www.threads.com/login' })
    fake.deps.markSessionUnhealthy = vi.fn((targetDb, reason) => {
      targetDb.prepare('UPDATE threads_session SET healthy = 0, health_note = ? WHERE id = 1').run(reason)
    })

    const result = await performThreadsReply(db, input, fake.deps)

    expect(result).toMatchObject({ status: 'failed', error: 'Threads session 已失效或尚未登入。' })
    expect(getThreadsSessionStatus(db)).toMatchObject({ healthy: false, healthNote: 'Threads 要求重新登入。' })
  })

  it('fails before submit when the reply button is not available', async () => {
    const db = openMemoryDatabase()
    const fake = fakeDeps({ visibleSelectors: new Set() })

    const result = await performThreadsReply(db, input, fake.deps)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('回覆按鈕')
    expect(fake.fills).toEqual([])
  })

  it('marks uncertain when submit happened but verification fails after reload', async () => {
    const db = openMemoryDatabase()
    const fake = fakeDeps({
      verifyResults: [
        { replyUrl: null, domMatch: false },
        { replyUrl: null, domMatch: false }
      ]
    })

    const result = await performThreadsReply(db, input, fake.deps)

    expect(result.status).toBe('uncertain')
    expect(result.error).toContain('無法在頁面上驗證')
    expect(fake.page.reload).toHaveBeenCalled()
  })

  it('blocks before opening a browser when kill switch is active', async () => {
    const db = openMemoryDatabase()
    setJitterMs(db, { min: 0, max: 0 })
    setKillSwitch(db, true)
    const fake = fakeDeps()

    await expect(performThreadsReply(db, input, { createContext: fake.deps.createContext })).rejects.toBeInstanceOf(KillSwitchActiveError)
    expect(fake.deps.createContext).not.toHaveBeenCalled()
  })

  it('blocks before opening a browser when reply quota is exhausted', async () => {
    const db = openMemoryDatabase()
    setJitterMs(db, { min: 0, max: 0 })
    setDailyLimits(db, { reply: 0 })
    const fake = fakeDeps()

    await expect(performThreadsReply(db, input, { createContext: fake.deps.createContext })).rejects.toBeInstanceOf(DailyQuotaExceededError)
    expect(fake.deps.createContext).not.toHaveBeenCalled()
  })
})
