import type { AppDatabase } from './db.js'
import { PatrolRepository } from './repository.js'
import { getRadarTrends, schedulePipelineForCandidates, upsertTrendCandidate } from './radar-trends.js'
import { searchThreadsViaGoogle, type ScanProgressEvent } from './threads-bot/google-search.js'

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

export type KeywordScanRun = {
  id: string
  cardId: string
  status: 'completed'
  message: string
  createdAt: string
  completedAt: string
  inserted: unknown[]
}

export async function scanKeywordCard(
  db: AppDatabase,
  cardId: string,
  onProgress?: (event: ScanProgressEvent) => void
): Promise<KeywordScanRun> {
  const repo = new PatrolRepository(db)
  const card = repo.getCardDetail(cardId)
  if (!card) throw new Error('找不到這張海巡卡。')

  const items = await searchThreadsViaGoogle(db, card.keyword, 6, onProgress)
  persistAndSchedule(db, cardId, items)
  return repo.createThreadsSearchRun(cardId, items)
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
