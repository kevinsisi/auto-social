import { normaliseSearchResults, type ThreadsFallbackOutcome } from './threads-fallback-search.js'
import type { GoogleCseConfig } from './search-settings.js'

type GoogleCseItem = {
  link?: string
  title?: string
  snippet?: string
  htmlTitle?: string
  htmlSnippet?: string
}

type GoogleCseResponse = {
  items?: GoogleCseItem[]
}

export type GoogleCseSearchProvider = (keyword: string, limit: number, config: GoogleCseConfig) => Promise<GoogleCseResponse>

type GoogleCseSearchOptions = {
  config?: GoogleCseConfig | null
  fetchGoogleCse?: GoogleCseSearchProvider
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_GOOGLE_CSE_RESULTS = 10

export async function fetchThreadsGoogleCseSearchOutcome(keyword: string, limit = 10, options: GoogleCseSearchOptions = {}): Promise<ThreadsFallbackOutcome> {
  const trimmed = keyword.trim()
  if (!trimmed) return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  if (!options.config) return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }

  try {
    const payload = await (options.fetchGoogleCse ?? fetchGoogleCseJson)(trimmed, limit, options.config)
    const candidates = normaliseSearchResults(extractGoogleCseResults(payload), trimmed).slice(0, limit)
    return candidates.length > 0
      ? { candidates, status: 'ok', providerUsed: 'google_cse', blockedProviders: [] }
      : { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  } catch {
    return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['google_cse'] }
  }
}

async function fetchGoogleCseJson(keyword: string, limit: number, config: GoogleCseConfig): Promise<GoogleCseResponse> {
  const query = `${keyword} (site:threads.net OR site:threads.com)`
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', config.apiKey)
  url.searchParams.set('cx', config.cx)
  url.searchParams.set('q', query)
  url.searchParams.set('num', String(Math.max(1, Math.min(limit, MAX_GOOGLE_CSE_RESULTS))))
  url.searchParams.set('hl', 'zh-TW')
  url.searchParams.set('gl', 'tw')
  url.searchParams.set('safe', 'active')
  url.searchParams.set('fields', 'items(title,link,snippet,htmlTitle,htmlSnippet)')

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Google Programmable Search returned HTTP ${response.status}`)
  return response.json() as Promise<GoogleCseResponse>
}

function extractGoogleCseResults(payload: GoogleCseResponse) {
  return (payload.items ?? []).map((item) => ({
    url: item.link ?? '',
    title: cleanGoogleCseText(item.title ?? item.htmlTitle ?? ''),
    excerpt: cleanGoogleCseText(item.snippet ?? item.htmlSnippet ?? '')
  }))
}

function cleanGoogleCseText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}
