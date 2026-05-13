import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { AppDatabase } from './db.js'
import { fetchThreadsSearchCandidates } from './sources/threads-search.js'
import { searchThreadsWithPlaywright } from './threads-bot/search.js'
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

type RadarCandidate = {
  url: string
  title: string
  excerpt: string
  source: 'threads_playwright' | 'threads_search'
}

type TrendCandidateRow = {
  source: 'threads_playwright' | 'threads_search'
  title: string | null
  text: string
}

const RADAR_SAMPLE_QUERIES = ['台灣', '生活', 'AI', '社群']
const CANDIDATES_PER_QUERY = 6
const MAX_TERMS = 70
const MIN_TERM_LENGTH = 2
const RADAR_WINDOW_MS = 24 * 60 * 60 * 1000

const stopWords = new Set([
  'Threads', 'threads', 'Thread', 'thread', 'Meta', 'meta', 'Instagram', 'instagram',
  'Playwright', 'playwright', 'query',
  '搜尋', '結果', '連結', '找到', '開頁', '確認', '原文', '互動', '觀察', 'Google', 'google',
  'https', 'http', 'www', 'com', 'net', 'post', 'search', 'login', 'privacy',
  '這個', '那個', '一個', '我們', '你們', '他們', '她們', '自己', '大家', '什麼', '怎麼',
  '可以', '不是', '沒有', '就是', '因為', '所以', '如果', '今天', '現在', '真的', '覺得',
  '的', '了', '和', '與', '在', '是', '有', '我', '你', '他', '她', '它', '們'
])

export function getRadarTrends(db: AppDatabase): RadarTrendResult {
  const since = new Date(Date.now() - RADAR_WINDOW_MS).toISOString()
  const rows = db.prepare(`
    SELECT source, title, text
    FROM trend_candidates
    WHERE is_trending = 1 AND fetched_at >= ?
    ORDER BY fetched_at DESC
    LIMIT 250
  `).all(since) as TrendCandidateRow[]
  const sourceCounts = new Map<'threads_playwright' | 'threads_search', number>()
  const text = rows.map((row) => {
    sourceCounts.set(row.source, (sourceCounts.get(row.source) ?? 0) + 1)
    return `${row.title ?? ''} ${sanitizeTrendText(row.text)}`
  }).join(' ')
  const sources = [...sourceCounts.keys()]
  return {
    terms: extractRadarTerms(text).slice(0, MAX_TERMS),
    source: sources.length > 1 ? 'mixed' : sources[0] ?? 'threads_search',
    sampledQueries: RADAR_SAMPLE_QUERIES.length,
    sampledCandidates: rows.length,
    errors: getLatestScanErrors(db)
  }
}

export async function scanRadarTrends(db: AppDatabase): Promise<RadarScanResult> {
  const scanId = nanoid()
  const startedAt = nowIso()
  db.prepare(`
    INSERT INTO scan_runs (id, started_at, status, reason, sources_summary_json, errors_json)
    VALUES (?, ?, 'running', 'manual_radar', ?, ?)
  `).run(scanId, startedAt, JSON.stringify({ queries: RADAR_SAMPLE_QUERIES }), JSON.stringify([]))

  const batches = await Promise.allSettled(RADAR_SAMPLE_QUERIES.map((query) => fetchRadarCandidates(db, query)))
  const errors: string[] = []
  let candidatesAdded = 0

  for (const [index, batch] of batches.entries()) {
    const query = RADAR_SAMPLE_QUERIES[index] ?? 'unknown'
    if (batch.status === 'rejected') {
      errors.push(batch.reason instanceof Error ? batch.reason.message : 'Threads 雷達抓取失敗')
      continue
    }
    for (const candidate of batch.value) {
      candidatesAdded += insertTrendCandidate(db, query, candidate)
    }
  }

  const endedAt = nowIso()
  const status = errors.length === RADAR_SAMPLE_QUERIES.length ? 'failed' : 'completed'
  db.prepare(`
    UPDATE scan_runs
    SET ended_at = ?, status = ?, candidates_added = ?, errors_json = ?
    WHERE id = ?
  `).run(endedAt, status, candidatesAdded, JSON.stringify(errors), scanId)

  return { ...getRadarTrends(db), errors, scanRun: { id: scanId, status, candidatesAdded } }
}

async function fetchRadarCandidates(db: AppDatabase, query: string): Promise<RadarCandidate[]> {
  try {
    return await searchThreadsWithPlaywright(db, query, CANDIDATES_PER_QUERY)
  } catch {
    return await fetchThreadsSearchCandidates(query, CANDIDATES_PER_QUERY)
  }
}

function insertTrendCandidate(db: AppDatabase, _query: string, candidate: RadarCandidate) {
  const fingerprint = createHash('sha256').update(`${candidate.source}:${candidate.url}`).digest('hex')
  const result = db.prepare(`
    INSERT OR IGNORE INTO trend_candidates (id, source, external_id, fingerprint, is_trending, url, title, text, fetched_at, pipeline_status)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'pending')
  `).run(nanoid(), candidate.source, candidate.url, fingerprint, candidate.url, candidate.title, candidate.excerpt, nowIso())
  return result.changes
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
    if (term.length < MIN_TERM_LENGTH || stopWords.has(term)) continue
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-TW'))
    .map(([word, count]) => ({ word, count }))
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
    return [...segmenter.segment(normalized)]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment.trim())
      .filter(Boolean)
  }
  return normalized.split(/\s+/).filter(Boolean)
}
