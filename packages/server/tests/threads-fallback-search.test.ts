import { describe, expect, it } from 'vitest'
import {
  extractThreadsLinks,
  fetchThreadsFallbackOutcome,
  isBingBlockPage,
  isGoogleBlockPage
} from '../src/sources/threads-fallback-search.js'

describe('extractThreadsLinks', () => {
  it('extracts Threads URLs embedded in Google /url?q= wrappers and direct hrefs', () => {
    const html = '<a href="/url?q=https://www.threads.net/@someone/post/abc&sa=U">result</a>' +
      '<a href="https://threads.net/@other/post/def">direct</a>'

    const results = extractThreadsLinks(html, '可麗餅')

    expect(results.map((item) => item.url)).toEqual([
      'https://www.threads.net/@someone/post/abc',
      'https://threads.net/@other/post/def'
    ])
  })

  it('deduplicates the same Threads URL appearing in different result blocks', () => {
    const html = '<a href="https://www.threads.net/@a/post/x">1</a>' +
      '<cite>https://www.threads.net/@a/post/x</cite>'

    const results = extractThreadsLinks(html, 'test')

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://www.threads.net/@a/post/x')
  })

  it('ignores non-post Threads URLs (search, login, profile)', () => {
    const html = '<a href="https://www.threads.net/search?q=foo">search</a>' +
      '<a href="https://www.threads.net/@some/post/abc">post</a>'

    const results = extractThreadsLinks(html, 'foo')

    expect(results.map((item) => item.url)).toEqual(['https://www.threads.net/@some/post/abc'])
  })
})

describe('isGoogleBlockPage', () => {
  it('flags the /sorry/ redirect URL', () => {
    expect(isGoogleBlockPage('<html>...</html>', 'https://www.google.com/sorry/index?continue=...')).toBe(true)
  })

  it('flags HTML containing httpservice/retry/enablejs retry-page hint', () => {
    const html = '<html><body><div>Please click <a href="/httpservice/retry/enablejs?ei=abc">here</a> to continue.</div></body></html>'

    expect(isGoogleBlockPage(html, 'https://www.google.com/search?q=foo')).toBe(true)
  })

  it('flags the unusual-traffic CAPTCHA gate', () => {
    const html = '<html><body><p>Our systems have detected unusual traffic from your computer network.</p></body></html>'

    expect(isGoogleBlockPage(html, 'https://www.google.com/search?q=foo')).toBe(true)
  })

  it('does not flag a normal search result page', () => {
    const html = '<html><body><a href="https://www.threads.net/@a/post/b">result</a></body></html>'

    expect(isGoogleBlockPage(html, 'https://www.google.com/search?q=foo')).toBe(false)
  })
})

describe('isBingBlockPage', () => {
  it('flags Bing CAPTCHA verification HTML', () => {
    const html = '<html><body><div>Verify you are human by completing the action below.</div></body></html>'

    expect(isBingBlockPage(html, 'https://www.bing.com/search?q=foo')).toBe(true)
  })

  it('flags ck/captcha URL', () => {
    expect(isBingBlockPage('<html/>', 'https://www.bing.com/ck/captcha?...')).toBe(true)
  })

  it('does not flag a normal Bing search result page', () => {
    const html = '<html><body><a href="https://www.threads.net/@a/post/b">result</a></body></html>'

    expect(isBingBlockPage(html, 'https://www.bing.com/search?q=foo')).toBe(false)
  })
})

describe('fetchThreadsFallbackOutcome', () => {
  const okResponse = (html: string, finalUrl = 'https://example.com', status = 200) => async () => ({ html, finalUrl, status })

  it('returns ok with Google when Google has Threads results', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchGoogle: okResponse('<a href="https://www.threads.net/@a/post/g1">x</a>'),
      fetchBing: okResponse('<a href="https://www.threads.net/@b/post/b1">y</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('google')
    expect(outcome.candidates.map((c) => c.url)).toEqual(['https://www.threads.net/@a/post/g1'])
    expect(outcome.blockedProviders).toEqual([])
  })

  it('falls back to Bing when Google is blocked (retry-page detected)', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchGoogle: okResponse('<html>httpservice/retry/enablejs</html>'),
      fetchBing: okResponse('<a href="https://www.threads.net/@b/post/b1">y</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('bing')
    expect(outcome.candidates.map((c) => c.url)).toEqual(['https://www.threads.net/@b/post/b1'])
    expect(outcome.blockedProviders).toEqual(['google'])
  })

  it('falls back to Bing when Google returns no extractable Threads URLs', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchGoogle: okResponse('<html>no results here</html>'),
      fetchBing: okResponse('<a href="https://www.threads.net/@b/post/b1">y</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('bing')
  })

  it('reports blocked when both providers are blocked', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchGoogle: okResponse('<html>httpservice/retry/enablejs</html>'),
      fetchBing: okResponse('<html>Verify you are human</html>')
    })

    expect(outcome.status).toBe('blocked')
    expect(outcome.providerUsed).toBeNull()
    expect(outcome.blockedProviders).toEqual(['google', 'bing'])
  })

  it('reports no_results when both providers respond normally but find nothing', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchGoogle: okResponse('<html>no threads here</html>'),
      fetchBing: okResponse('<html>also nothing</html>')
    })

    expect(outcome.status).toBe('no_results')
    expect(outcome.providerUsed).toBeNull()
    expect(outcome.blockedProviders).toEqual([])
  })

  it('treats 429 / 5xx as blocked for the provider that returned the status', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchGoogle: okResponse('whatever', 'https://www.google.com', 429),
      fetchBing: okResponse('<a href="https://www.threads.net/@b/post/b1">y</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('bing')
    expect(outcome.blockedProviders).toEqual(['google'])
  })

  it('treats a thrown fetch error (timeout, DNS) as blocked', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchGoogle: async () => { throw new Error('timeout') },
      fetchBing: okResponse('<a href="https://www.threads.net/@b/post/b1">y</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('bing')
    expect(outcome.blockedProviders).toEqual(['google'])
  })

  it('honours limit when Google returns more candidates than asked for', async () => {
    const html = '<a href="https://www.threads.net/@a/post/1">a</a>' +
      '<a href="https://www.threads.net/@a/post/2">b</a>' +
      '<a href="https://www.threads.net/@a/post/3">c</a>'

    const outcome = await fetchThreadsFallbackOutcome('foo', {
      limit: 2,
      fetchGoogle: okResponse(html),
      fetchBing: okResponse('<html/>')
    })

    expect(outcome.candidates).toHaveLength(2)
    expect(outcome.providerUsed).toBe('google')
  })
})
