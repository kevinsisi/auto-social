import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { fetchThreadsSearchOutcome } from '../src/sources/threads-search.js'

describe('threads search cache and cooldown', () => {
  const okResponse = (html: string, finalUrl = 'https://example.com', status = 200) => async () => ({ html, finalUrl, status })

  it('serves a fresh cached outcome without hitting providers again', async () => {
    const db = openMemoryDatabase()
    const first = await fetchThreadsSearchOutcome('Urus', 10, db, {
      fetchBing: okResponse('<a href="https://www.threads.net/@cars/post/1">Urus 交車心得</a>'),
      fetchDuckDuckGo: okResponse('<html/>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: okResponse('<html/>')
    })

    const second = await fetchThreadsSearchOutcome('Urus', 10, db, {
      fetchBing: async () => { throw new Error('cache miss') },
      fetchDuckDuckGo: async () => { throw new Error('cache miss') },
      fetchDuckDuckGoLite: async () => { throw new Error('cache miss') },
      fetchGoogle: async () => { throw new Error('cache miss') }
    })

    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    expect(second.candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/1'])
  })

  it('tries public browser search before raw HTML providers', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      useBrowser: true,
      browserSearch: async () => ({
        candidates: [{ source: 'threads_search', url: 'https://www.threads.net/@cars/post/browser', title: 'Urus Threads 討論', excerpt: 'Urus 車主分享保養心得' }],
        status: 'ok',
        providerUsed: 'duckduckgo_browser',
        blockedProviders: []
      }),
      fetchBing: async () => { throw new Error('raw provider should not run') }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('duckduckgo_browser')
  })

  it('tries Brave Search API before browser and raw providers', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      useBrave: true,
      braveSearchApiKey: 'test-key',
      braveSearch: async () => ({
        web: {
          results: [
            { url: 'https://www.threads.net/@cars/post/brave', title: 'Urus Brave result', description: 'Threads 上的 Urus 討論' }
          ]
        }
      }),
      useBrowser: true,
      browserSearch: async () => { throw new Error('browser provider should not run') },
      fetchBing: async () => { throw new Error('raw provider should not run') }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('brave')
    expect(outcome.candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/brave'])
  })

  it('falls back to browser search when Brave Search API is blocked', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      useBrave: true,
      braveSearchApiKey: 'test-key',
      braveSearch: async () => { throw new Error('Brave rate limit') },
      useBrowser: true,
      browserSearch: async () => ({
        candidates: [{ source: 'threads_search', url: 'https://www.threads.net/@cars/post/browser-after-brave', title: 'Urus Threads 討論', excerpt: 'Urus 車主分享保養心得' }],
        status: 'ok',
        providerUsed: 'duckduckgo_browser',
        blockedProviders: []
      }),
      fetchBing: async () => { throw new Error('raw provider should not run') }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('duckduckgo_browser')
    expect(outcome.blockedProviders).toEqual(['brave'])
  })

  it('falls back to raw HTML providers when browser search finds no results', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      useBrowser: true,
      browserSearch: async () => ({ candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }),
      fetchBing: okResponse('<a href="https://www.threads.net/@cars/post/raw">Urus raw result</a>'),
      fetchDuckDuckGo: okResponse('<html/>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: okResponse('<html/>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('bing')
    expect(outcome.candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/raw'])
  })

  it('skips a provider after it was blocked once', async () => {
    const db = openMemoryDatabase()
    await fetchThreadsSearchOutcome('法拉利', 10, db, {
      fetchBing: okResponse('<html>Verify you are human</html>'),
      fetchDuckDuckGo: okResponse('<html/>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: okResponse('<html/>')
    })

    const second = await fetchThreadsSearchOutcome('法拉利', 10, db, {
      fetchBing: async () => { throw new Error('Bing should be cooling down') },
      fetchDuckDuckGo: okResponse('<a href="https://www.threads.net/@cars/post/2">法拉利 車主心得</a>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: okResponse('<html/>')
    })

    expect(second.status).toBe('ok')
    expect(second.providerUsed).toBe('duckduckgo')
    expect(second.blockedProviders).toEqual(['bing'])
  })
})
