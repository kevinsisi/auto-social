import type { AppDatabase } from './db.js'
import { PatrolRepository } from './repository.js'
import { getRadarTrends, schedulePipelineForCandidates, upsertTrendCandidate } from './radar-trends.js'
import { fetchThreadsSearchCandidates } from './sources/threads-search.js'
import { searchThreadsWithPlaywright } from './threads-bot/search.js'
import { DailyQuotaExceededError, KillSwitchActiveError } from './threads-bot/throttle.js'

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

export async function scanKeywordCard(db: AppDatabase, cardId: string): Promise<KeywordScanRun> {
  const repo = new PatrolRepository(db)
  const card = repo.getCardDetail(cardId)
  if (!card) throw new Error('找不到這張海巡卡。')

  try {
    const items = await searchThreadsWithPlaywright(db, card.keyword)
    persistAndSchedule(db, cardId, items)
    return repo.createThreadsSearchRun(cardId, items)
  } catch (playwrightError) {
    if (playwrightError instanceof KillSwitchActiveError) throw playwrightError
    const items = await fetchThreadsSearchCandidates(card.keyword)
    persistAndSchedule(db, cardId, items)
    const run = repo.createThreadsSearchRun(cardId, items)
    const reason = playwrightError instanceof Error ? playwrightError.message : 'Threads Playwright 搜尋失敗'
    const fallbackReason = playwrightError instanceof DailyQuotaExceededError ? 'Threads 配額已用完' : 'Playwright 失敗'
    return { ...run, message: `${run.message}（${fallbackReason}，已改用 Google site:threads.net/site:threads.com 備援：${reason}）` }
  }
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
