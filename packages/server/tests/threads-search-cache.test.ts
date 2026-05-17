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
