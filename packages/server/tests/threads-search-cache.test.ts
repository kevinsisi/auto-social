import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../src/db.js'
import { fetchThreadsSearchOutcome } from '../src/sources/threads-search.js'

describe('threads search cache and cooldown', () => {
  const okResponse = (html: string, finalUrl = 'https://example.com', status = 200) => async () => ({ html, finalUrl, status })

  it('serves a fresh cached outcome without hitting providers again', async () => {
    const db = openMemoryDatabase()
    const first = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      fetchBing: okResponse('<a href="https://www.threads.net/@cars/post/1">Urus 交車心得</a>'),
      fetchDuckDuckGo: okResponse('<html/>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: okResponse('<html/>')
    })

    const second = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      fetchBing: async () => { throw new Error('cache miss') },
      fetchDuckDuckGo: async () => { throw new Error('cache miss') },
      fetchDuckDuckGoLite: async () => { throw new Error('cache miss') },
      fetchGoogle: async () => { throw new Error('cache miss') }
    })

    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    expect(second.candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/1'])
  })

  it('tries self-hosted Threads public search before external providers', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      usePublicSearch: true,
      publicSearch: async () => ({
        candidates: [{ source: 'threads_search', url: 'https://www.threads.net/@cars/post/public', title: 'Urus Threads 討論', excerpt: 'Urus 車主分享保養心得' }],
        status: 'ok',
        providerUsed: 'threads_public_search',
        blockedProviders: []
      }),
      useBrowser: true,
      useExternalSearchFallbacks: true,
      browserSearch: async () => { throw new Error('browser provider should not run') }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('threads_public_search')
    expect(outcome.candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/public'])
  })

  it('refreshes old public-search cache entries that predate media extraction', async () => {
    const db = openMemoryDatabase()
    db.prepare('INSERT INTO threads_search_cache (keyword, outcome_json, cached_at) VALUES (?, ?, ?)').run(
      'urus',
      JSON.stringify({
        candidates: [{ source: 'threads_search', url: 'https://www.threads.net/@cars/post/old', title: 'Urus', excerpt: 'Urus old cache' }],
        status: 'ok',
        providerUsed: 'threads_public_search',
        blockedProviders: []
      }),
      new Date().toISOString()
    )

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      publicSearch: async () => ({
        candidates: [{ source: 'threads_search', url: 'https://www.threads.net/@cars/post/new', title: 'Urus', excerpt: 'Urus with media', images: ['https://cdninstagram.com/photo.webp'] }],
        status: 'ok',
        providerUsed: 'threads_public_search',
        blockedProviders: []
      })
    })

    expect(outcome.candidates[0]).toMatchObject({
      url: 'https://www.threads.net/@cars/post/new',
      images: ['https://cdninstagram.com/photo.webp']
    })
  })

  it('tries external public browser search when public search is skipped', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      usePublicSearch: false,
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

  it('falls back to external browser search by default when self-hosted search has no results', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      publicSearch: async () => ({ candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }),
      browserSearch: async () => ({
        candidates: [{ source: 'threads_search', url: 'https://www.threads.net/@cars/post/browser-default', title: 'Urus Threads 討論', excerpt: 'Urus 車主分享保養心得' }],
        status: 'ok',
        providerUsed: 'duckduckgo_browser',
        blockedProviders: []
      })
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('duckduckgo_browser')
  })

  it('falls back to browser search when self-hosted public search is blocked and external fallback is enabled', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      usePublicSearch: true,
      publicSearch: async () => ({ candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['threads_public_search'] }),
      useBrowser: true,
      browserSearch: async () => ({
        candidates: [{ source: 'threads_search', url: 'https://www.threads.net/@cars/post/browser-after-public', title: 'Urus Threads 討論', excerpt: 'Urus 車主分享保養心得' }],
        status: 'ok',
        providerUsed: 'duckduckgo_browser',
        blockedProviders: []
      }),
      fetchBing: async () => { throw new Error('raw provider should not run') }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('duckduckgo_browser')
    expect(outcome.blockedProviders).toEqual(['threads_public_search'])
  })

  it('reports self-hosted public search as blocked while it is cooling down', async () => {
    const db = openMemoryDatabase()
    await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      useExternalSearchFallbacks: false,
      usePublicSearch: true,
      publicSearch: async () => ({ candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['threads_public_search'] })
    })

    const second = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      useExternalSearchFallbacks: false,
      usePublicSearch: true,
      publicSearch: async () => { throw new Error('public search should be cooling down') }
    })

    expect(second.status).toBe('blocked')
    expect(second.blockedProviders).toEqual(['threads_public_search'])
  })

  it('falls back to raw HTML providers when browser search finds no results', async () => {
    const db = openMemoryDatabase()

    const outcome = await fetchThreadsSearchOutcome('Urus', 10, db, {
      hydratePosts: false,
      usePublicSearch: false,
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
      hydratePosts: false,
      usePublicSearch: false,
      fetchBing: okResponse('<html>Verify you are human</html>'),
      fetchDuckDuckGo: okResponse('<html/>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: okResponse('<html/>')
    })

    const second = await fetchThreadsSearchOutcome('法拉利', 10, db, {
      hydratePosts: false,
      usePublicSearch: false,
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
