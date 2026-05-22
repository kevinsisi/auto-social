import type { AppDatabase } from '../db.js'
import { extractThreadsLinks, fetchThreadsFallbackOutcome, type ThreadsFallbackOptions, type ThreadsFallbackOutcome, type ThreadsFallbackProvider, type ThreadsSearchCandidate } from './threads-fallback-search.js'
import { fetchThreadsBrowserSearchOutcome } from './threads-browser-search.js'
import { hydrateThreadsPostCandidates } from './threads-post-hydrator.js'
import { fetchThreadsPublicSearchOutcome, type ThreadsPublicSearchProvider } from './threads-public-search.js'

export type { ThreadsSearchCandidate, ThreadsFallbackOutcome, ThreadsFallbackProvider }
export { extractThreadsLinks }

const MAX_RESULTS = 10
const FRESH_CACHE_MS = 30 * 60 * 1000
const STALE_CACHE_MS = 24 * 60 * 60 * 1000
const THREADS_SEARCH_MEDIA_CACHE_SCHEMA_VERSION = 2
const PROVIDER_COOLDOWN_MS: Record<ThreadsFallbackProvider, number> = {
  threads_public_search: 20 * 60 * 1000,
  duckduckgo_browser: 20 * 60 * 1000,
  bing: 3 * 60 * 60 * 1000,
  google: 6 * 60 * 60 * 1000,
  duckduckgo: 20 * 60 * 1000,
  duckduckgo_lite: 20 * 60 * 1000
}
type BrowserSearchProvider = (keyword: string, limit: number) => Promise<ThreadsFallbackOutcome>
type ThreadsSearchOptions = ThreadsFallbackOptions & {
  publicSearch?: ThreadsPublicSearchProvider
  browserSearch?: BrowserSearchProvider
  usePublicSearch?: boolean
  useBrowser?: boolean
  useExternalSearchFallbacks?: boolean
  hydratePosts?: boolean
}
type CachedThreadsFallbackOutcome = ThreadsFallbackOutcome & {
  searchMediaSchemaVersion?: number
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
  const publicOutcome = await maybeRunPublicSearch(keyword, limit, skipProviders, options)
  recordBlockedProviders(db, publicOutcome.blockedProviders)
  if (publicOutcome.status === 'ok') {
    storeCachedOutcome(db, keyword, publicOutcome)
    return publicOutcome
  }

  if (!shouldRunExternalSearchFallbacks(options)) {
    const stale = getCachedOutcome(db, keyword, STALE_CACHE_MS)
    if (stale) return limitOutcome(stale, limit)
    return publicOutcome.status === 'blocked'
      ? { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: publicOutcome.blockedProviders }
      : { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: publicOutcome.blockedProviders }
  }

  const browserSkipProviders = uniqueProviders([...skipProviders, ...publicOutcome.blockedProviders])
  const browserOutcome = await maybeRunBrowserSearch(keyword, limit, browserSkipProviders, options)
  recordBlockedProviders(db, browserOutcome.blockedProviders)
  if (browserOutcome.status === 'ok') {
    const outcome = await maybeHydrateOutcome({ ...browserOutcome, blockedProviders: uniqueProviders([...publicOutcome.blockedProviders, ...browserOutcome.blockedProviders]) }, options)
    storeCachedOutcome(db, keyword, outcome)
    return outcome
  }

  const rawSkipProviders = browserSkipProviders.filter((provider) => provider !== 'duckduckgo_browser')
  const outcome = await fetchThreadsFallbackOutcome(keyword, { ...options, limit, skipProviders: rawSkipProviders })
  outcome.blockedProviders = uniqueProviders([...publicOutcome.blockedProviders, ...browserOutcome.blockedProviders, ...outcome.blockedProviders])
  recordBlockedProviders(db, outcome.blockedProviders)
  if (outcome.status === 'ok') {
    const hydrated = await maybeHydrateOutcome(outcome, options)
    storeCachedOutcome(db, keyword, hydrated)
    return hydrated
  }

  const stale = getCachedOutcome(db, keyword, STALE_CACHE_MS)
  return stale ? limitOutcome(stale, limit) : outcome
}

async function maybeRunPublicSearch(keyword: string, limit: number, skipProviders: ThreadsFallbackProvider[], options: ThreadsSearchOptions): Promise<ThreadsFallbackOutcome> {
  const hasRawFetchOverride = Boolean(options.fetchBing || options.fetchDuckDuckGo || options.fetchDuckDuckGoLite || options.fetchGoogle)
  const usePublicSearch = options.usePublicSearch ?? !hasRawFetchOverride
  if (!usePublicSearch) {
    return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  }
  if (skipProviders.includes('threads_public_search')) return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['threads_public_search'] }
  return (options.publicSearch ?? fetchThreadsPublicSearchOutcome)(keyword, limit)
}

function normaliseKeyword(keyword: string) {
  return keyword.trim().toLowerCase()
}

function getCachedOutcome(db: AppDatabase, keyword: string, maxAgeMs: number): ThreadsFallbackOutcome | null {
  const row = db.prepare('SELECT outcome_json, cached_at FROM threads_search_cache WHERE keyword = ?').get(normaliseKeyword(keyword)) as { outcome_json: string; cached_at: string } | undefined
  if (!row) return null
  if (Date.now() - Date.parse(row.cached_at) > maxAgeMs) return null
  try {
    const parsed = JSON.parse(row.outcome_json) as CachedThreadsFallbackOutcome
    if (parsed.searchMediaSchemaVersion !== THREADS_SEARCH_MEDIA_CACHE_SCHEMA_VERSION) return null
    const { searchMediaSchemaVersion: _schemaVersion, ...outcome } = parsed
    return outcome
  } catch {
    return null
  }
}

async function maybeRunBrowserSearch(keyword: string, limit: number, skipProviders: ThreadsFallbackProvider[], options: ThreadsSearchOptions): Promise<ThreadsFallbackOutcome> {
  const hasRawFetchOverride = Boolean(options.fetchBing || options.fetchDuckDuckGo || options.fetchDuckDuckGoLite || options.fetchGoogle)
  const useBrowser = options.useBrowser ?? !hasRawFetchOverride
  if (!useBrowser) {
    return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  }
  if (skipProviders.includes('duckduckgo_browser')) return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['duckduckgo_browser'] }
  return (options.browserSearch ?? fetchThreadsBrowserSearchOutcome)(keyword, limit)
}

function shouldRunExternalSearchFallbacks(options: ThreadsSearchOptions) {
  return options.useExternalSearchFallbacks ?? process.env.AUTO_SOCIAL_EXTERNAL_SEARCH_FALLBACKS !== '0'
}

function storeCachedOutcome(db: AppDatabase, keyword: string, outcome: ThreadsFallbackOutcome) {
  const cached: CachedThreadsFallbackOutcome = { ...outcome, searchMediaSchemaVersion: THREADS_SEARCH_MEDIA_CACHE_SCHEMA_VERSION }
  db.prepare(`
    INSERT INTO threads_search_cache (keyword, outcome_json, cached_at)
    VALUES (?, ?, ?)
    ON CONFLICT(keyword) DO UPDATE SET outcome_json = excluded.outcome_json, cached_at = excluded.cached_at
  `).run(normaliseKeyword(keyword), JSON.stringify(cached), new Date().toISOString())
}

async function maybeHydrateOutcome(outcome: ThreadsFallbackOutcome, options: ThreadsSearchOptions): Promise<ThreadsFallbackOutcome> {
  if (options.hydratePosts === false || outcome.status !== 'ok' || outcome.providerUsed === 'threads_public_search') return outcome
  const candidates = await hydrateThreadsPostCandidates(outcome.candidates)
  return { ...outcome, candidates }
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
  return value === 'threads_public_search' || value === 'duckduckgo_browser' || value === 'bing' || value === 'google' || value === 'duckduckgo' || value === 'duckduckgo_lite'
}

function uniqueProviders(providers: ThreadsFallbackProvider[]) {
  return [...new Set(providers)]
}
