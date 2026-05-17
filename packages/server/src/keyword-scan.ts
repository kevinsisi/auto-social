import type { AppDatabase } from './db.js'
import { PatrolRepository } from './repository.js'
import { getRadarTrends, schedulePipelineForCandidates, upsertTrendCandidate } from './radar-trends.js'
import { fetchThreadsSearchOutcome } from './sources/threads-search.js'
import type { ThreadsFallbackProvider } from './sources/threads-search.js'

export type ScanProgressEvent =
  | { stage: 'searching' }
  | { stage: 'fallback'; provider: ThreadsFallbackProvider }
  | { stage: 'done'; found: number }

type ScanCandidate = {
  url: string
  title: string
  excerpt: string
  source: 'threads_playwright' | 'threads_search'
  author?: string | null
  postedAt?: string | null
  likes?: number | null
  replyCount?: number | null
  reposts?: number | null
  shares?: number | null
  images?: string[] | null
  videos?: Array<{ src: string; poster: string | null }> | null
}

export type KeywordScanOutcomeKind = 'playwright_ok' | 'fallback_ok' | 'no_matching_threads_results' | 'search_provider_blocked'

export type KeywordScanRun = {
  id: string
  cardId: string
  status: 'completed'
  message: string
  createdAt: string
  completedAt: string
  inserted: unknown[]
  outcomeKind: KeywordScanOutcomeKind
  providerUsed: 'threads_playwright' | ThreadsFallbackProvider | null
  blockedProviders: ThreadsFallbackProvider[]
}

export async function scanKeywordCard(
  db: AppDatabase,
  cardId: string,
  onProgress?: (event: ScanProgressEvent) => void
): Promise<KeywordScanRun> {
  const repo = new PatrolRepository(db)
  const card = repo.getCardDetail(cardId)
  if (!card) throw new Error('找不到這張海巡卡。')

  onProgress?.({ stage: 'searching' })

  let items: ScanCandidate[] = []
  let outcomeKind: KeywordScanOutcomeKind = 'fallback_ok'
  let providerUsed: 'threads_playwright' | ThreadsFallbackProvider | null = null
  let blockedProviders: ThreadsFallbackProvider[] = []

  const fallback = await fetchThreadsSearchOutcome(card.keyword, undefined, db)
  blockedProviders = fallback.blockedProviders
  if (fallback.status === 'ok' && fallback.providerUsed) {
    onProgress?.({ stage: 'fallback', provider: fallback.providerUsed })
    items = fallback.candidates
    providerUsed = fallback.providerUsed
    outcomeKind = 'fallback_ok'
  } else if (fallback.status === 'blocked') {
    outcomeKind = 'search_provider_blocked'
  } else {
    outcomeKind = 'no_matching_threads_results'
  }

  onProgress?.({ stage: 'done', found: items.length })
  persistAndSchedule(db, cardId, items)
  const run = repo.createThreadsSearchRun(cardId, items, { outcomeKind, providerUsed, blockedProviders })
  return { ...run, outcomeKind, providerUsed, blockedProviders }
}

function persistAndSchedule(db: AppDatabase, cardId: string, items: ScanCandidate[]) {
  const newIds: string[] = []
  for (const item of items) {
    const result = upsertTrendCandidate(db, item, { cardId, isTrending: false })
    if (result.inserted && result.id) newIds.push(result.id)
  }
  schedulePipelineForCandidates(db, newIds)
}

export function getComposeSeedKeyword(db: AppDatabase) {
  const radar = getRadarTrends(db)
  return radar.terms[0]?.word ?? null
}
