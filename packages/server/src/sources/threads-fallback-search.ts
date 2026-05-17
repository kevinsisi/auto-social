export type ThreadsSearchCandidate = {
  url: string
  title: string
  excerpt: string
  source: 'threads_search'
}

export type ThreadsFallbackProvider = 'google' | 'bing' | 'duckduckgo' | 'duckduckgo_lite'

export type ThreadsFallbackStatus = 'ok' | 'no_results' | 'blocked'

export type ThreadsFallbackOutcome = {
  candidates: ThreadsSearchCandidate[]
  status: ThreadsFallbackStatus
  providerUsed: ThreadsFallbackProvider | null
  blockedProviders: ThreadsFallbackProvider[]
}

type ProviderProbe = {
  provider: ThreadsFallbackProvider
  candidates: ThreadsSearchCandidate[]
  blocked: boolean
}

type FetchProvider = (keyword: string) => Promise<{ html: string; finalUrl: string; status: number }>

type Options = {
  limit?: number
  fetchGoogle?: FetchProvider
  fetchBing?: FetchProvider
  fetchDuckDuckGo?: FetchProvider
  fetchDuckDuckGoLite?: FetchProvider
}

const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_LIMIT = 10
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

export async function fetchThreadsFallbackOutcome(keyword: string, options: Options = {}): Promise<ThreadsFallbackOutcome> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const probes: ProviderProbe[] = []
  const blockedProviders: ThreadsFallbackProvider[] = []

  // 1. Bing first: Google often returns JS retry pages to server-side fetches.
  const bingResult = await runProvider('bing', () => (options.fetchBing ?? fetchBingHtml)(keyword), keyword)
  probes.push(bingResult)
  if (bingResult.candidates.length > 0) {
    return ok(bingResult.candidates.slice(0, limit), 'bing', blockedProviders)
  }
  if (bingResult.blocked) blockedProviders.push('bing')

  // 2. DuckDuckGo HTML often stays available when Bing/Google CAPTCHA server-side fetches.
  const duckResult = await runProvider('duckduckgo', () => (options.fetchDuckDuckGo ?? fetchDuckDuckGoHtml)(keyword), keyword)
  probes.push(duckResult)
  if (duckResult.candidates.length > 0) {
    return ok(duckResult.candidates.slice(0, limit), 'duckduckgo', blockedProviders)
  }
  if (duckResult.blocked) blockedProviders.push('duckduckgo')

  // 3. DuckDuckGo Lite has simpler markup and is a useful no-API fallback.
  const duckLiteResult = await runProvider('duckduckgo_lite', () => (options.fetchDuckDuckGoLite ?? fetchDuckDuckGoLiteHtml)(keyword), keyword)
  probes.push(duckLiteResult)
  if (duckLiteResult.candidates.length > 0) {
    return ok(duckLiteResult.candidates.slice(0, limit), 'duckduckgo_lite', blockedProviders)
  }
  if (duckLiteResult.blocked) blockedProviders.push('duckduckgo_lite')

  // 4. Google remains the final fallback when the other public endpoints are empty.
  const googleResult = await runProvider('google', () => (options.fetchGoogle ?? fetchGoogleHtml)(keyword), keyword)
  probes.push(googleResult)
  if (googleResult.candidates.length > 0) {
    return ok(googleResult.candidates.slice(0, limit), 'google', blockedProviders)
  }
  if (googleResult.blocked) blockedProviders.push('google')

  // 5. No public search provider returned candidates.
  const everyoneBlocked = probes.every((p) => p.blocked)
  return {
    candidates: [],
    status: everyoneBlocked ? 'blocked' : 'no_results',
    providerUsed: null,
    blockedProviders
  }
}

function ok(candidates: ThreadsSearchCandidate[], providerUsed: ThreadsFallbackProvider, blockedProviders: ThreadsFallbackProvider[]): ThreadsFallbackOutcome {
  return { candidates, status: 'ok', providerUsed, blockedProviders }
}

async function runProvider(
  provider: ThreadsFallbackProvider,
  fetcher: () => Promise<{ html: string; finalUrl: string; status: number }>,
  keyword: string
): Promise<ProviderProbe> {
  try {
    const { html, finalUrl, status } = await fetcher()
    if (status >= 500 || status === 429) {
      return { provider, candidates: [], blocked: true }
    }
    const blocked = isProviderBlockPage(provider, html, finalUrl)
    if (blocked) return { provider, candidates: [], blocked: true }
    const candidates = extractThreadsLinks(html, keyword)
    return { provider, candidates, blocked: false }
  } catch {
    return { provider, candidates: [], blocked: true }
  }
}

async function fetchGoogleHtml(keyword: string): Promise<{ html: string; finalUrl: string; status: number }> {
  const query = `${keyword.trim()} (site:threads.net OR site:threads.com)`
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-TW`
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const html = await response.text()
  return { html, finalUrl: response.url, status: response.status }
}

async function fetchBingHtml(keyword: string): Promise<{ html: string; finalUrl: string; status: number }> {
  const query = `${keyword.trim()} (site:threads.net OR site:threads.com)`
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-TW&cc=TW`
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const html = await response.text()
  return { html, finalUrl: response.url, status: response.status }
}

async function fetchDuckDuckGoHtml(keyword: string): Promise<{ html: string; finalUrl: string; status: number }> {
  const query = `${keyword.trim()} (site:threads.net OR site:threads.com)`
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=tw-tzh`
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const html = await response.text()
  return { html, finalUrl: response.url, status: response.status }
}

async function fetchDuckDuckGoLiteHtml(keyword: string): Promise<{ html: string; finalUrl: string; status: number }> {
  const query = `${keyword.trim()} (site:threads.net OR site:threads.com)`
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=tw-tzh`
  const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const html = await response.text()
  return { html, finalUrl: response.url, status: response.status }
}

const THREADS_URL_PATTERN = /https:\/\/(?:www\.)?threads\.(?:net|com)\/@[A-Za-z0-9_.]+\/post\/[A-Za-z0-9_-]+/g
const THREADS_URL_CANONICAL_PATTERN = /https:\/\/(?:www\.)?threads\.(?:net|com)\/@[A-Za-z0-9_.]+\/post\/[A-Za-z0-9_-]+/
const HREF_PATTERN = /href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi

export function extractThreadsLinks(html: string, keyword: string): ThreadsSearchCandidate[] {
  const seen = new Map<string, ThreadsSearchCandidate>()
  for (const result of extractSearchResults(html)) {
    const url = canonicalisePostUrl(result.url)
    if (!url) continue
    if (seen.has(url)) continue
    seen.set(url, {
      url,
      title: result.title || `Threads 搜尋結果：${keyword}`,
      excerpt: result.excerpt || '備援搜尋找到的 Threads 連結；開頁確認原文後再互動。',
      source: 'threads_search'
    })
  }
  return [...seen.values()]
}

function isProviderBlockPage(provider: ThreadsFallbackProvider, html: string, finalUrl: string) {
  if (provider === 'google') return isGoogleBlockPage(html, finalUrl)
  if (provider === 'bing') return isBingBlockPage(html, finalUrl)
  return isDuckDuckGoBlockPage(html, finalUrl)
}

function extractSearchResults(html: string): Array<{ url: string; title: string; excerpt: string }> {
  const results: Array<{ url: string; title: string; excerpt: string }> = []
  const values = extractSearchUrlValues(html)
  for (const value of values) {
    const index = findSearchValueIndex(html, value)
    const block = index >= 0 ? html.slice(Math.max(0, index - 1200), Math.min(html.length, index + 1800)) : ''
    results.push({
      url: value,
      title: extractTitle(block),
      excerpt: extractSnippet(block)
    })
  }
  return results
}

function findSearchValueIndex(html: string, value: string): number {
  const direct = html.indexOf(value)
  if (direct >= 0) return direct
  const encoded = encodeURIComponent(value)
  const encodedIndex = html.indexOf(encoded)
  if (encodedIndex >= 0) return encodedIndex
  return html.indexOf(encoded.replace(/%20/g, '+'))
}

function extractTitle(block: string): string {
  const h3 = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]
  const anchor = block.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1]
  return cleanSearchText(h3 ?? anchor ?? '').slice(0, 100)
}

function extractSnippet(block: string): string {
  const selectors = [
    /<p[^>]*>([\s\S]*?)<\/p>/i,
    /<a[^>]+class="[^"]*(?:result__snippet|snippet)[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    /<div[^>]+class="[^"]*(?:VwiC3b|b_caption|snippet)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<span[^>]+class="[^"]*(?:aCOpRe|st)[^"]*"[^>]*>([\s\S]*?)<\/span>/i
  ]
  for (const pattern of selectors) {
    const text = cleanSearchText(block.match(pattern)?.[1] ?? '')
    if (text.length >= 12) return text.slice(0, 240)
  }
  return ''
}

function cleanSearchText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSearchUrlValues(html: string): string[] {
  const values = new Set<string>()
  const htmlDecoded = decodeHtmlEntities(html).replace(/\\\//g, '/')
  for (const match of htmlDecoded.matchAll(THREADS_URL_PATTERN)) values.add(match[0] ?? '')
  for (const match of html.matchAll(HREF_PATTERN)) {
    addDecodedVariants(values, match[1] ?? match[2] ?? match[3] ?? '')
  }
  return [...values]
}

function addDecodedVariants(values: Set<string>, raw: string) {
  if (!raw) return
  const htmlDecoded = decodeHtmlEntities(raw).replace(/\\\//g, '/')
  const uriDecoded = decodeUriRepeated(htmlDecoded)
  for (const nested of extractUrlParams(uriDecoded)) values.add(nested)
  values.add(htmlDecoded)
  values.add(uriDecoded)
}

function extractUrlParams(raw: string): string[] {
  const out: string[] = []
  try {
    const parsed = new URL(raw, 'https://www.bing.com')
    for (const key of ['url', 'q', 'u', 'uddg', 'target']) {
      const value = parsed.searchParams.get(key)
      if (!value) continue
      const decoded = decodeBingUParam(value) ?? decodeUriRepeated(value)
      out.push(decoded)
    }
  } catch {
    for (const match of raw.matchAll(/[?&](?:url|q|u|uddg|target)=([^&]+)/gi)) {
      const value = match[1] ?? ''
      const decoded = decodeBingUParam(value) ?? decodeUriRepeated(value)
      out.push(decoded)
    }
  }
  return out
}

function decodeBingUParam(value: string): string | null {
  const decodedValue = decodeUriRepeated(value)
  if (!decodedValue.startsWith('a1')) return null
  const encoded = decodedValue.slice(2).replace(/-/g, '+').replace(/_/g, '/')
  try {
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return decoded.startsWith('http') ? decoded : null
  } catch {
    return null
  }
}

function decodeUriRepeated(value: string): string {
  let current = value
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(current)
      if (next === current) return next
      current = next
    } catch {
      return current
    }
  }
  return current
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function canonicalisePostUrl(raw: string): string | null {
  return raw.match(THREADS_URL_CANONICAL_PATTERN)?.[0] ?? null
}

const GOOGLE_BLOCK_HINTS = [
  'unusual traffic from your computer network',
  'Our systems have detected unusual traffic',
  'httpservice/retry/enablejs',
  '/sorry/index',
  'detected unusual activity',
  '請證明你不是機器人',
  'enablejs'
]

export function isGoogleBlockPage(html: string, finalUrl: string): boolean {
  if (finalUrl.includes('/sorry/')) return true
  if (finalUrl.includes('httpservice/retry/enablejs')) return true
  const lowered = html.toLowerCase()
  return GOOGLE_BLOCK_HINTS.some((hint) => lowered.includes(hint.toLowerCase()))
}

const BING_BLOCK_HINTS = [
  'verify you are human',
  'this challenge is to ensure',
  'recaptcha',
  '請完成驗證',
  '最後一個步驟',
  '請解決以下挑戰',
  'turnstile',
  'challenges.cloudflare.com',
  'cloudflarehandlecaptcha'
]

export function isBingBlockPage(html: string, finalUrl: string): boolean {
  if (/bing\.com\/.*ck\/captcha/i.test(finalUrl)) return true
  const lowered = html.toLowerCase()
  return BING_BLOCK_HINTS.some((hint) => lowered.includes(hint.toLowerCase()))
}

const DUCKDUCKGO_BLOCK_HINTS = [
  'anomaly-modal',
  'Unfortunately, bots use DuckDuckGo too',
  'please complete the following challenge',
  'please prove you are a human',
  'duckduckgo.com/anomaly',
  '請完成以下挑戰',
  '請證明你是真人'
]

export function isDuckDuckGoBlockPage(html: string, finalUrl: string): boolean {
  if (/duckduckgo\.com\/anomaly/i.test(finalUrl)) return true
  const lowered = html.toLowerCase()
  return DUCKDUCKGO_BLOCK_HINTS.some((hint) => lowered.includes(hint.toLowerCase()))
}
