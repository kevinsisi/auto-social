import type { AppDatabase } from './db.js'
import { PatrolRepository } from './repository.js'
import { getRadarTrends, schedulePipelineForCandidates, upsertTrendCandidate } from './radar-trends.js'
import { fetchThreadsSearchCandidates } from './sources/threads-search.js'
import { searchThreadsWithPlaywright } from './threads-bot/search.js'
import { DailyQuotaExceededError } from './threads-bot/throttle.js'

export type ScanProgressEvent =
  | { stage: 'searching' }
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

  onProgress?.({ stage: 'searching' })
  let items: ScanCandidate[]
  let fallbackNote = ''
  try {
    items = await searchThreadsWithPlaywright(db, card.keyword)
  } catch (error) {
    if (!isDailyQuotaExceeded(error)) throw error
    items = await fetchThreadsSearchCandidates(card.keyword)
    fallbackNote = `（Threads 配額已用完，已改用 Google site:threads.net/site:threads.com 備援：${getErrorMessage(error)}）`
  }
  onProgress?.({ stage: 'done', found: items.length })
  persistAndSchedule(db, cardId, items)
  const run = repo.createThreadsSearchRun(cardId, items)
  if (!fallbackNote) return run
  const message = `${run.message}${fallbackNote}`
  db.prepare('UPDATE patrol_runs SET message = ? WHERE id = ?').run(message, run.id)
  return { ...run, message }
}

function isDailyQuotaExceeded(error: unknown) {
  return error instanceof DailyQuotaExceededError || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'DAILY_QUOTA_EXCEEDED')
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Threads search 每日上限已用完。'
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
