import { normaliseSearchResults, type ThreadsFallbackOutcome } from './threads-fallback-search.js'

type BraveSearchResult = {
  url?: string
  title?: string
  description?: string
  extra_snippets?: string[]
}

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[]
  }
}

export type BraveSearchProvider = (keyword: string, limit: number, apiKey: string) => Promise<BraveSearchResponse>

type BraveSearchOptions = {
  apiKey?: string
  fetchBrave?: BraveSearchProvider
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_BRAVE_RESULTS = 20

export async function fetchThreadsBraveSearchOutcome(keyword: string, limit = 10, options: BraveSearchOptions = {}): Promise<ThreadsFallbackOutcome> {
  const trimmed = keyword.trim()
  if (!trimmed) return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }

  const apiKey = options.apiKey ?? process.env.BRAVE_SEARCH_API_KEY?.trim()
  if (!apiKey) return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }

  try {
    const payload = await (options.fetchBrave ?? fetchBraveSearchJson)(trimmed, limit, apiKey)
    const candidates = normaliseSearchResults(extractBraveResults(payload), trimmed).slice(0, limit)
    return candidates.length > 0
      ? { candidates, status: 'ok', providerUsed: 'brave', blockedProviders: [] }
      : { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  } catch {
    return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['brave'] }
  }
}

async function fetchBraveSearchJson(keyword: string, limit: number, apiKey: string): Promise<BraveSearchResponse> {
  const count = Math.max(1, Math.min(limit * 2, MAX_BRAVE_RESULTS))
  const query = `${keyword} (site:threads.net OR site:threads.com)`
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(count))
  url.searchParams.set('country', 'TW')
  url.searchParams.set('search_lang', 'zh-hant')
  url.searchParams.set('ui_lang', 'zh-TW')
  url.searchParams.set('safesearch', 'moderate')
  url.searchParams.set('text_decorations', 'false')
  url.searchParams.set('result_filter', 'web')

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Brave Search API returned HTTP ${response.status}`)
  return response.json() as Promise<BraveSearchResponse>
}

function extractBraveResults(payload: BraveSearchResponse) {
  return (payload.web?.results ?? []).map((result) => ({
    url: result.url ?? '',
    title: cleanBraveText(result.title ?? ''),
    excerpt: cleanBraveText([result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(' '))
  }))
}

function cleanBraveText(value: string) {
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
