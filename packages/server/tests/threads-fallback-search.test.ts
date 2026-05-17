import { describe, expect, it } from 'vitest'
import {
  extractThreadsLinks,
  fetchThreadsFallbackOutcome,
  isBingBlockPage,
  isDuckDuckGoBlockPage,
  isGoogleBlockPage
} from '../src/sources/threads-fallback-search.js'

describe('extractThreadsLinks', () => {
  it('extracts Threads URLs embedded in Google /url?q= wrappers and direct hrefs', () => {
    const html = '<a href="/url?q=https://www.threads.net/@someone/post/abc&sa=U">可麗餅 result</a>' +
      '<a href="https://threads.net/@other/post/def">可麗餅 direct</a>'

    const results = extractThreadsLinks(html, '可麗餅')

    expect(results.map((item) => item.url)).toEqual([
      'https://www.threads.net/@someone/post/abc',
      'https://threads.net/@other/post/def'
    ])
  })

  it('extracts Threads URLs from Bing /ck/a u=a1 redirect wrappers', () => {
    const target = 'https://www.threads.com/@cars/post/BING123'
    const encoded = Buffer.from(target, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    const html = `<a href="/ck/a?!&&p=abc&u=a1${encoded}&ntb=1">Urus result</a>`

    const results = extractThreadsLinks(html, 'Urus')

    expect(results.map((item) => item.url)).toEqual([target])
  })

  it('extracts readable title and snippet from search result blocks', () => {
    const html = '<li class="b_algo"><h2><a href="https://www.threads.net/@a/post/b">法拉利新車討論</a></h2><div class="b_caption"><p>大家在 Threads 上討論法拉利交車與保養成本。</p></div></li>'

    const results = extractThreadsLinks(html, '法拉利')

    expect(results[0]).toMatchObject({
      title: '法拉利新車討論',
      excerpt: '大家在 Threads 上討論法拉利交車與保養成本。'
    })
  })

  it('extracts Threads URLs from DuckDuckGo uddg redirect wrappers', () => {
    const target = 'https://www.threads.net/@duck/post/DDG123'
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}">Urus 車主討論</a><a class="result__snippet">大家在 Threads 上討論 Urus 保養和日常用車。</a></div>`

    const results = extractThreadsLinks(html, 'Threads')

    expect(results.map((item) => item.url)).toEqual([target])
    expect(results[0]).toMatchObject({
      title: 'Urus 車主討論',
      excerpt: '大家在 Threads 上討論 Urus 保養和日常用車。'
    })
  })

  it('deduplicates the same Threads URL appearing in different result blocks', () => {
    const html = '<a href="https://www.threads.net/@a/post/x">test 1</a>' +
      '<cite>https://www.threads.net/@a/post/x</cite>'

    const results = extractThreadsLinks(html, 'test')

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://www.threads.net/@a/post/x')
  })

  it('ignores non-post Threads URLs (search, login, profile)', () => {
    const html = '<a href="https://www.threads.net/search?q=foo">search</a>' +
      '<a href="https://www.threads.net/@some/post/abc">foo post</a>'

    const results = extractThreadsLinks(html, 'foo')

    expect(results.map((item) => item.url)).toEqual(['https://www.threads.net/@some/post/abc'])
  })

  it('skips context-free redirect URLs so generic samples do not reach the pipeline', () => {
    const html = '<script>var u="https://www.threads.net/@some/post/no-context"</script>'

    const results = extractThreadsLinks(html, 'foo')

    expect(results).toEqual([])
  })

  it('skips Threads landing pages and keyword-irrelevant results', () => {
    const html = '<a href="https://www.threads.net/@login/post/abc">加入 Threads 即可分享想法、提問問題、使用你的 Instagram 登入。</a>' +
      '<a href="https://www.threads.net/@music/post/def">最近大家推薦的播放清單</a>' +
      '<a href="https://www.threads.net/@cars/post/ghi">法拉利交車心得</a>'

    const results = extractThreadsLinks(html, '法拉利')

    expect(results.map((item) => item.url)).toEqual(['https://www.threads.net/@cars/post/ghi'])
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

  it('flags Bing Cloudflare Turnstile challenge HTML', () => {
    const html = '<html><body><div class="captcha_header">最後一個步驟</div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>'

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

describe('isDuckDuckGoBlockPage', () => {
  it('flags DuckDuckGo anomaly pages', () => {
    expect(isDuckDuckGoBlockPage('<html/>', 'https://duckduckgo.com/anomaly.js?sv=html')).toBe(true)
  })

  it('flags DuckDuckGo challenge HTML', () => {
    const html = '<html><body>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge.</body></html>'

    expect(isDuckDuckGoBlockPage(html, 'https://html.duckduckgo.com/html/?q=foo')).toBe(true)
  })

  it('does not flag a normal DuckDuckGo result page', () => {
    const html = '<html><body><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.threads.net%2F%40a%2Fpost%2Fb">result</a></body></html>'

    expect(isDuckDuckGoBlockPage(html, 'https://html.duckduckgo.com/html/?q=foo')).toBe(false)
  })
})

describe('fetchThreadsFallbackOutcome', () => {
  const okResponse = (html: string, finalUrl = 'https://example.com', status = 200) => async () => ({ html, finalUrl, status })
  const duckEmpty = {
    fetchDuckDuckGo: okResponse('<html/>'),
    fetchDuckDuckGoLite: okResponse('<html/>')
  }

  it('returns ok with Bing when Bing has Threads results', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      ...duckEmpty,
      fetchGoogle: okResponse('<a href="https://www.threads.net/@a/post/g1">foo x</a>'),
      fetchBing: okResponse('<a href="https://www.threads.net/@b/post/b1">foo y</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('bing')
    expect(outcome.candidates.map((c) => c.url)).toEqual(['https://www.threads.net/@b/post/b1'])
    expect(outcome.blockedProviders).toEqual([])
  })

  it('falls back to Google when Bing is blocked', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      ...duckEmpty,
      fetchBing: okResponse('<html>Verify you are human</html>'),
      fetchGoogle: okResponse('<a href="https://www.threads.net/@a/post/g1">foo x</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('google')
    expect(outcome.candidates.map((c) => c.url)).toEqual(['https://www.threads.net/@a/post/g1'])
    expect(outcome.blockedProviders).toEqual(['bing'])
  })

  it('falls back to Google when Bing returns no extractable Threads URLs', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      ...duckEmpty,
      fetchBing: okResponse('<html>no results here</html>'),
      fetchGoogle: okResponse('<a href="https://www.threads.net/@a/post/g1">foo x</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('google')
  })

  it('falls back to DuckDuckGo before Google', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchBing: okResponse('<html>no results here</html>'),
      fetchDuckDuckGo: okResponse('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.threads.net%2F%40d%2Fpost%2Fddg1">foo d</a>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: okResponse('<a href="https://www.threads.net/@a/post/g1">foo x</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('duckduckgo')
    expect(outcome.candidates.map((c) => c.url)).toEqual(['https://www.threads.net/@d/post/ddg1'])
  })

  it('falls back to DuckDuckGo Lite when regular DuckDuckGo is blocked', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchBing: okResponse('<html>no results here</html>'),
      fetchDuckDuckGo: okResponse('<html>Unfortunately, bots use DuckDuckGo too</html>'),
      fetchDuckDuckGoLite: okResponse('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.threads.net%2F%40l%2Fpost%2Flite1">foo l</a>'),
      fetchGoogle: okResponse('<html/>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('duckduckgo_lite')
    expect(outcome.blockedProviders).toEqual(['duckduckgo'])
  })

  it('reports blocked when both providers are blocked', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      fetchBing: okResponse('<html>Verify you are human</html>'),
      fetchDuckDuckGo: okResponse('<html>Unfortunately, bots use DuckDuckGo too</html>'),
      fetchDuckDuckGoLite: okResponse('<html>Please complete the following challenge</html>'),
      fetchGoogle: okResponse('<html>httpservice/retry/enablejs</html>')
    })

    expect(outcome.status).toBe('blocked')
    expect(outcome.providerUsed).toBeNull()
    expect(outcome.blockedProviders).toEqual(['bing', 'duckduckgo', 'duckduckgo_lite', 'google'])
  })

  it('reports no_results when both providers respond normally but find nothing', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      ...duckEmpty,
      fetchBing: okResponse('<html>also nothing</html>'),
      fetchGoogle: okResponse('<html>no threads here</html>')
    })

    expect(outcome.status).toBe('no_results')
    expect(outcome.providerUsed).toBeNull()
    expect(outcome.blockedProviders).toEqual([])
  })

  it('skips providers that are already cooling down', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      skipProviders: ['bing', 'google'],
      fetchBing: async () => { throw new Error('should not call Bing') },
      fetchDuckDuckGo: okResponse('<a href="https://www.threads.net/@d/post/1">foo d</a>'),
      fetchDuckDuckGoLite: okResponse('<html/>'),
      fetchGoogle: async () => { throw new Error('should not call Google') }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('duckduckgo')
    expect(outcome.blockedProviders).toEqual(['bing'])
  })

  it('treats 429 / 5xx as blocked for the provider that returned the status', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      ...duckEmpty,
      fetchBing: okResponse('whatever', 'https://www.bing.com', 429),
      fetchGoogle: okResponse('<a href="https://www.threads.net/@a/post/g1">foo x</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('google')
    expect(outcome.blockedProviders).toEqual(['bing'])
  })

  it('treats a thrown fetch error (timeout, DNS) as blocked', async () => {
    const outcome = await fetchThreadsFallbackOutcome('foo', {
      ...duckEmpty,
      fetchBing: async () => { throw new Error('timeout') },
      fetchGoogle: okResponse('<a href="https://www.threads.net/@a/post/g1">foo x</a>')
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('google')
    expect(outcome.blockedProviders).toEqual(['bing'])
  })

  it('honours limit when Bing returns more candidates than asked for', async () => {
    const html = '<a href="https://www.threads.net/@a/post/1">foo a</a>' +
      '<a href="https://www.threads.net/@a/post/2">foo b</a>' +
      '<a href="https://www.threads.net/@a/post/3">foo c</a>'

    const outcome = await fetchThreadsFallbackOutcome('foo', {
      ...duckEmpty,
      limit: 2,
      fetchBing: okResponse(html),
      fetchGoogle: okResponse('<html/>')
    })

    expect(outcome.candidates).toHaveLength(2)
    expect(outcome.providerUsed).toBe('bing')
  })
})
