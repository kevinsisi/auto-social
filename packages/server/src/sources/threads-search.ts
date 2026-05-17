import type { AppDatabase } from '../db.js'
import { extractThreadsLinks, fetchThreadsFallbackOutcome, type ThreadsFallbackOptions, type ThreadsFallbackOutcome, type ThreadsFallbackProvider, type ThreadsSearchCandidate } from './threads-fallback-search.js'
import { fetchThreadsBrowserSearchOutcome } from './threads-browser-search.js'

export type { ThreadsSearchCandidate, ThreadsFallbackOutcome, ThreadsFallbackProvider }
export { extractThreadsLinks }

const MAX_RESULTS = 10
const FRESH_CACHE_MS = 30 * 60 * 1000
const STALE_CACHE_MS = 24 * 60 * 60 * 1000
const PROVIDER_COOLDOWN_MS: Record<ThreadsFallbackProvider, number> = {
  duckduckgo_browser: 20 * 60 * 1000,
  bing: 3 * 60 * 60 * 1000,
  google: 6 * 60 * 60 * 1000,
  duckduckgo: 20 * 60 * 1000,
  duckduckgo_lite: 20 * 60 * 1000
}
type BrowserSearchProvider = (keyword: string, limit: number) => Promise<ThreadsFallbackOutcome>
type ThreadsSearchOptions = ThreadsFallbackOptions & {
  browserSearch?: BrowserSearchProvider
  useBrowser?: boolean
}

export async function fetchThreadsSearchCandidates(keyword: string, limit = MAX_RESULTS, db?: AppDatabase, options: ThreadsSearchOptions = {}): Promise<ThreadsSearchCandidate[]> {
  const outcome = await fetchThreadsSearchOutcome(keyword, limit, db, options)
  return outcome.candidates
}

export async function fetchThreadsSearchOutcome(keyword: string, limit = MAX_RESULTS, db?: AppDatabase, options: ThreadsSearchOptions = {}): Promise<ThreadsFallbackOutcome> {
  if (!db) return fetchThreadsFallbackOutcome(keyword, { ...options, limit })

  const fresh = getCachedOutcome(db, keyword, FRESH_CACHE_MS)
  if (fresh) return limitOutcome(fresh, limit)

  const skipProviders = getCoolingProviders(db)
  const browserOutcome = await maybeRunBrowserSearch(keyword, limit, skipProviders, options)
  recordBlockedProviders(db, browserOutcome.blockedProviders)
  if (browserOutcome.status === 'ok') {
    storeCachedOutcome(db, keyword, browserOutcome)
    return browserOutcome
  }

  const rawSkipProviders = skipProviders.filter((provider) => provider !== 'duckduckgo_browser')
  const outcome = await fetchThreadsFallbackOutcome(keyword, { ...options, limit, skipProviders: rawSkipProviders })
  outcome.blockedProviders = uniqueProviders([...browserOutcome.blockedProviders, ...outcome.blockedProviders])
  recordBlockedProviders(db, outcome.blockedProviders)
  if (outcome.status === 'ok') {
    storeCachedOutcome(db, keyword, outcome)
    return outcome
  }

  const stale = getCachedOutcome(db, keyword, STALE_CACHE_MS)
  return stale ? limitOutcome(stale, limit) : outcome
}

function normaliseKeyword(keyword: string) {
  return keyword.trim().toLowerCase()
}

function getCachedOutcome(db: AppDatabase, keyword: string, maxAgeMs: number): ThreadsFallbackOutcome | null {
  const row = db.prepare('SELECT outcome_json, cached_at FROM threads_search_cache WHERE keyword = ?').get(normaliseKeyword(keyword)) as { outcome_json: string; cached_at: string } | undefined
  if (!row) return null
  if (Date.now() - Date.parse(row.cached_at) > maxAgeMs) return null
  try {
    return JSON.parse(row.outcome_json) as ThreadsFallbackOutcome
  } catch {
    return null
  }
}

async function maybeRunBrowserSearch(keyword: string, limit: number, skipProviders: ThreadsFallbackProvider[], options: ThreadsSearchOptions): Promise<ThreadsFallbackOutcome> {
  const hasRawFetchOverride = Boolean(options.fetchBing || options.fetchDuckDuckGo || options.fetchDuckDuckGoLite || options.fetchGoogle)
  const useBrowser = options.useBrowser ?? !hasRawFetchOverride
  if (!useBrowser || skipProviders.includes('duckduckgo_browser')) {
    return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  }
  return (options.browserSearch ?? fetchThreadsBrowserSearchOutcome)(keyword, limit)
}

function storeCachedOutcome(db: AppDatabase, keyword: string, outcome: ThreadsFallbackOutcome) {
  db.prepare(`
    INSERT INTO threads_search_cache (keyword, outcome_json, cached_at)
    VALUES (?, ?, ?)
    ON CONFLICT(keyword) DO UPDATE SET outcome_json = excluded.outcome_json, cached_at = excluded.cached_at
  `).run(normaliseKeyword(keyword), JSON.stringify(outcome), new Date().toISOString())
}

function getCoolingProviders(db: AppDatabase): ThreadsFallbackProvider[] {
  const rows = db.prepare('SELECT provider FROM threads_search_provider_cooldowns WHERE blocked_until > ?').all(new Date().toISOString()) as Array<{ provider: string }>
  return rows.map((row) => row.provider).filter(isThreadsFallbackProvider)
}

function recordBlockedProviders(db: AppDatabase, providers: ThreadsFallbackProvider[]) {
  const now = Date.now()
  const statement = db.prepare(`
    INSERT INTO threads_search_provider_cooldowns (provider, blocked_until, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET blocked_until = excluded.blocked_until, updated_at = excluded.updated_at
  `)
  for (const provider of providers) {
    statement.run(provider, new Date(now + PROVIDER_COOLDOWN_MS[provider]).toISOString(), new Date(now).toISOString())
  }
}

function limitOutcome(outcome: ThreadsFallbackOutcome, limit: number): ThreadsFallbackOutcome {
  return { ...outcome, candidates: outcome.candidates.slice(0, limit) }
}

function isThreadsFallbackProvider(value: string): value is ThreadsFallbackProvider {
  return value === 'duckduckgo_browser' || value === 'bing' || value === 'google' || value === 'duckduckgo' || value === 'duckduckgo_lite'
}

function uniqueProviders(providers: ThreadsFallbackProvider[]) {
  return [...new Set(providers)]
}
