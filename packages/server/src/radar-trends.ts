import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { AppDatabase } from './db.js'
import { enqueueTask } from './scheduler/task-queue.js'
import { fetchThreadsSearchCandidates } from './sources/threads-search.js'
import { searchThreadsWithPlaywright } from './threads-bot/search.js'
import { DailyQuotaExceededError, KillSwitchActiveError } from './threads-bot/throttle.js'
import { nowIso } from './time.js'

export type RadarTerm = {
  word: string
  count: number
}

export type RadarTrendResult = {
  terms: RadarTerm[]
  source: 'threads_playwright' | 'threads_search' | 'mixed'
  sampledQueries: number
  sampledCandidates: number
  errors: string[]
}

export type RadarScanResult = RadarTrendResult & {
  scanRun: {
    id: string
    status: 'completed' | 'failed'
    candidatesAdded: number
  }
}

export type RadarCandidate = {
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

type TrendCandidateRow = {
  source: 'threads_playwright' | 'threads_search'
  title: string | null
  text: string
  engagement_json: string | null
}

type RadarSampleQuery = {
  keyword: string
  cardId: string | null
}

const DEFAULT_RADAR_SAMPLE_QUERIES = ['台灣', '生活', 'AI', '社群']
const MAX_RADAR_SAMPLE_QUERIES = 6
const CANDIDATES_PER_QUERY = 6
const MAX_TERMS = 70
const MIN_TERM_LENGTH = 2
const RADAR_WINDOW_MS = 24 * 60 * 60 * 1000

const stopWords = new Set([
  'Threads', 'threads', 'Thread', 'thread', 'Meta', 'meta', 'Instagram', 'instagram',
  'Playwright', 'playwright', 'query',
  '搜尋', '結果', '連結', '找到', '抓到', '開頁', '確認', '原文', '互動', '觀察', 'Google', 'google',
  '分享', '更多', '留言', '轉發', '翻譯', '靜音', '編輯',
  'https', 'http', 'www', 'com', 'net', 'post', 'search', 'login', 'privacy',
  '這個', '那個', '一個', '我們', '你們', '他們', '她們', '自己', '大家', '什麼', '怎麼',
  '可以', '不是', '沒有', '就是', '因為', '所以', '如果', '今天', '現在', '真的', '覺得',
  '一下', '有人', '東西', '這是', '都會', '直接', '記得', '一起', '出來', '加入', '正式',
  '這次', '這裡', '原本', '發現', '休息', '先前', '再次', '各位', '已經', '不只', '不需要',
  '一件', '一期', '一塊', '下次', '下限', '在做', '用到', '來了', '將會', '預計',
  '的', '了', '和', '與', '在', '是', '有', '我', '你', '他', '她', '它', '們'
])

export function getRadarTrends(db: AppDatabase): RadarTrendResult {
  const since = new Date(Date.now() - RADAR_WINDOW_MS).toISOString()
  const sampleQueries = getRadarSampleQueries(db)
  const hasMonitoredCards = sampleQueries.some((query) => query.cardId)
  const rows = db.prepare(`
    SELECT source, title, text, engagement_json
    FROM trend_candidates
    WHERE is_trending = 1 AND fetched_at >= ? AND (? = 0 OR card_id IS NOT NULL)
    ORDER BY fetched_at DESC
    LIMIT 250
  `).all(since, hasMonitoredCards ? 1 : 0) as TrendCandidateRow[]
  const sourceCounts = new Map<'threads_playwright' | 'threads_search', number>()
  for (const row of rows) {
    sourceCounts.set(row.source, (sourceCounts.get(row.source) ?? 0) + 1)
  }
  const sources = [...sourceCounts.keys()]
  return {
    terms: extractRadarTermsFromRows(rows, sampleQueries.filter((query) => query.cardId).map((query) => query.keyword)).slice(0, MAX_TERMS),
    source: sources.length > 1 ? 'mixed' : sources[0] ?? 'threads_search',
    sampledQueries: sampleQueries.length,
    sampledCandidates: rows.length,
    errors: getLatestScanErrors(db)
  }
}

export async function scanRadarTrends(db: AppDatabase): Promise<RadarScanResult> {
  const scanId = nanoid()
  const startedAt = nowIso()
  const queries = getRadarSampleQueries(db)
  db.prepare(`
    INSERT INTO scan_runs (id, started_at, status, reason, sources_summary_json, errors_json)
    VALUES (?, ?, 'running', 'manual_radar', ?, ?)
  `).run(scanId, startedAt, JSON.stringify({ queries }), JSON.stringify([]))

  const batches = await Promise.allSettled(queries.map((query) => fetchRadarCandidates(db, query.keyword)))
  const errors: string[] = []
  const newCandidateIds: string[] = []

  for (const [index, batch] of batches.entries()) {
    const query = queries[index]
    if (batch.status === 'rejected') {
      errors.push(batch.reason instanceof Error ? batch.reason.message : 'Threads 雷達抓取失敗')
      continue
    }
    for (const candidate of batch.value) {
      const result = upsertTrendCandidate(db, candidate, { cardId: query?.cardId ?? null, isTrending: true })
      if (result.inserted && result.id) newCandidateIds.push(result.id)
    }
  }

  const endedAt = nowIso()
  const status = errors.length === queries.length ? 'failed' : 'completed'
  db.prepare(`
    UPDATE scan_runs
    SET ended_at = ?, status = ?, candidates_added = ?, errors_json = ?
    WHERE id = ?
  `).run(endedAt, status, newCandidateIds.length, JSON.stringify(errors), scanId)

  schedulePipelineForCandidates(db, newCandidateIds)

  return { ...getRadarTrends(db), errors, scanRun: { id: scanId, status, candidatesAdded: newCandidateIds.length } }
}

export function schedulePipelineForCandidates(db: AppDatabase, candidateIds: string[]) {
  for (const id of candidateIds) {
    const row = db.prepare('SELECT substr(text, 1, 40) AS preview FROM trend_candidates WHERE id = ?').get(id) as { preview: string } | undefined
    enqueueTask(db, {
      type: 'pipeline',
      label: row?.preview ? `pipeline · ${row.preview.trim()}` : `pipeline · ${id}`,
      payload: { candidateId: id },
      dedupeKey: `pipeline:${id}`
    })
  }
}

async function fetchRadarCandidates(db: AppDatabase, query: string): Promise<RadarCandidate[]> {
  try {
    return await searchThreadsWithPlaywright(db, query, CANDIDATES_PER_QUERY)
  } catch (error) {
    if (error instanceof KillSwitchActiveError) throw error
    return await fetchThreadsSearchCandidates(query, CANDIDATES_PER_QUERY)
  }
}

function getRadarSampleQueries(db: AppDatabase): RadarSampleQuery[] {
  const rows = db.prepare(`
    SELECT id, keyword
    FROM patrol_cards
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(MAX_RADAR_SAMPLE_QUERIES) as Array<{ id: string; keyword: string }>
  const monitored: RadarSampleQuery[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const keyword = row.keyword.trim()
    if (!keyword || seen.has(keyword)) continue
    seen.add(keyword)
    monitored.push({ keyword, cardId: row.id })
  }
  return monitored.length > 0 ? monitored : DEFAULT_RADAR_SAMPLE_QUERIES.map((keyword) => ({ keyword, cardId: null }))
}

function insertTrendCandidate(db: AppDatabase, _query: string, candidate: RadarCandidate) {
  return upsertTrendCandidate(db, candidate, { isTrending: true }).inserted ? 1 : 0
}

export type UpsertTrendCandidateOptions = {
  cardId?: string | null
  isTrending?: boolean
}

export type UpsertTrendCandidateResult = {
  id: string | null
  inserted: boolean
}

export function upsertTrendCandidate(db: AppDatabase, candidate: RadarCandidate, options: UpsertTrendCandidateOptions = {}): UpsertTrendCandidateResult {
  const fingerprint = createHash('sha256').update(`${candidate.source}:${candidate.url}`).digest('hex')
  const engagementValues = {
    likes: candidate.likes ?? null,
    replies: candidate.replyCount ?? null,
    reposts: candidate.reposts ?? null,
    shares: candidate.shares ?? null
  }
  const hasEngagement = Object.values(engagementValues).some((value) => value !== null)
  const engagementJson = hasEngagement ? JSON.stringify(engagementValues) : null
  const images = candidate.images?.filter((src) => typeof src === 'string' && src.length > 0) ?? []
  const imagesJson = images.length > 0 ? JSON.stringify(images) : null
  const videos = candidate.videos?.filter((video) => video && typeof video.src === 'string' && video.src.length > 0) ?? []
  const videosJson = videos.length > 0 ? JSON.stringify(videos) : null
  const id = nanoid()
  const result = db.prepare(`
    INSERT OR IGNORE INTO trend_candidates (id, source, external_id, fingerprint, card_id, is_trending, url, author, title, text, published_at, engagement_json, images_json, videos_json, fetched_at, pipeline_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    id,
    candidate.source,
    candidate.url,
    fingerprint,
    options.cardId ?? null,
    options.isTrending ? 1 : 0,
    candidate.url,
    candidate.author ?? null,
    candidate.title,
    candidate.excerpt,
    candidate.postedAt ?? null,
    engagementJson,
    imagesJson,
    videosJson,
    nowIso()
  )
  if (result.changes > 0) return { id, inserted: true }
  const existing = db.prepare('SELECT id FROM trend_candidates WHERE fingerprint = ?').get(fingerprint) as { id: string } | undefined
  if (existing) {
    db.prepare(`
      UPDATE trend_candidates
      SET card_id = COALESCE(card_id, ?),
          is_trending = CASE WHEN ? = 1 THEN 1 ELSE is_trending END,
          author = COALESCE(?, author),
          title = ?,
          text = ?,
          published_at = COALESCE(?, published_at),
          engagement_json = COALESCE(?, engagement_json),
          images_json = COALESCE(?, images_json),
          videos_json = COALESCE(?, videos_json),
          fetched_at = ?
      WHERE id = ?
    `).run(
      options.cardId ?? null,
      options.isTrending ? 1 : 0,
      candidate.author ?? null,
      candidate.title,
      candidate.excerpt,
      candidate.postedAt ?? null,
      engagementJson,
      imagesJson,
      videosJson,
      nowIso(),
      existing.id
    )
  }
  return { id: existing?.id ?? null, inserted: false }
}

function sanitizeTrendText(text: string) {
  return text.replace(/\n\s*\n觀察 query：[^\n]*/g, ' ')
}

function getLatestScanErrors(db: AppDatabase) {
  const row = db.prepare(`
    SELECT errors_json
    FROM scan_runs
    WHERE reason = 'manual_radar'
    ORDER BY started_at DESC
    LIMIT 1
  `).get() as { errors_json: string | null } | undefined
  if (!row?.errors_json) return []
  try {
    const parsed = JSON.parse(row.errors_json)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function extractRadarTerms(text: string): RadarTerm[] {
  const counts = new Map<string, number>()
  for (const term of segmentText(text)) {
    if (shouldSkipTerm(term)) continue
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-TW'))
    .map(([word, count]) => ({ word, count }))
}

function extractRadarTermsFromRows(rows: TrendCandidateRow[], sampleKeywords: string[]): RadarTerm[] {
  const scores = new Map<string, number>()
  for (const row of rows) {
    const weight = getEngagementWeight(row.engagement_json)
    const text = `${row.title ?? ''} ${sanitizeTrendText(row.text)}`
    for (const term of segmentText(text)) {
      if (shouldSkipTerm(term)) continue
      scores.set(term, (scores.get(term) ?? 0) + weight)
    }
    for (const keyword of sampleKeywords) {
      if (keyword.length >= MIN_TERM_LENGTH && text.includes(keyword)) scores.set(keyword, (scores.get(keyword) ?? 0) + weight * 4)
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-TW'))
    .map(([word, count]) => ({ word, count: Math.round(count) }))
}

function getEngagementWeight(json: string | null) {
  if (!json) return 1
  try {
    const parsed = JSON.parse(json) as Partial<Record<'likes' | 'replies' | 'reposts' | 'shares', unknown>>
    const score = numberOrZero(parsed.likes) + numberOrZero(parsed.replies) * 3 + numberOrZero(parsed.reposts) * 5 + numberOrZero(parsed.shares) * 2
    return 1 + Math.log10(score + 1)
  } catch {
    return 1
  }
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function shouldSkipTerm(term: string) {
  return term.length < MIN_TERM_LENGTH || stopWords.has(term)
}

function segmentText(text: string) {
  const normalized = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\p{P}\p{S}\d_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('zh-TW', { granularity: 'word' })
    : null
  if (segmenter) {
    const segmented = [...segmenter.segment(normalized)]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment.trim())
      .filter(Boolean)
    return [...segmented, ...extractShortCjkChunks(normalized, segmented)]
  }
  return normalized.split(/\s+/).filter(Boolean)
}

function extractShortCjkChunks(text: string, segmented: string[]) {
  const segmentedTerms = new Set(segmented)
  return text.split(/\s+/).filter((term) => /^[\p{Script=Han}]{2,6}$/u.test(term) && !segmentedTerms.has(term))
}
