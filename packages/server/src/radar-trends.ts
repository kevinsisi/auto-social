import type { AppDatabase } from './db.js'
import { fetchThreadsSearchCandidates } from './sources/threads-search.js'
import { searchThreadsWithPlaywright } from './threads-bot/search.js'

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

const RADAR_SAMPLE_QUERIES = ['台灣', '生活', 'AI', '社群']
const CANDIDATES_PER_QUERY = 6
const MAX_TERMS = 70
const MIN_TERM_LENGTH = 2

const stopWords = new Set([
  'Threads', 'threads', 'Thread', 'thread', 'Meta', 'meta', 'Instagram', 'instagram',
  '搜尋', '結果', '連結', '找到', '開頁', '確認', '原文', '互動', 'Google', 'google',
  'https', 'http', 'www', 'com', 'net', 'post', 'search', 'login', 'privacy',
  '這個', '那個', '一個', '我們', '你們', '他們', '她們', '自己', '大家', '什麼', '怎麼',
  '可以', '不是', '沒有', '就是', '因為', '所以', '如果', '今天', '現在', '真的', '覺得',
  '的', '了', '和', '與', '在', '是', '有', '我', '你', '他', '她', '它', '們'
])

export async function fetchRadarTrends(db: AppDatabase): Promise<RadarTrendResult> {
  const batches = await Promise.allSettled(RADAR_SAMPLE_QUERIES.map((query) => fetchRadarCandidates(db, query)))
  const errors: string[] = []
  const sourceCounts = new Map<'threads_playwright' | 'threads_search', number>()
  const texts: string[] = []

  for (const batch of batches) {
    if (batch.status === 'rejected') {
      errors.push(batch.reason instanceof Error ? batch.reason.message : 'Threads 雷達抓取失敗')
      continue
    }
    for (const candidate of batch.value) {
      texts.push(`${candidate.title} ${candidate.excerpt}`)
      sourceCounts.set(candidate.source, (sourceCounts.get(candidate.source) ?? 0) + 1)
    }
  }

  const sources = [...sourceCounts.keys()]
  return {
    terms: extractRadarTerms(texts.join(' ')).slice(0, MAX_TERMS),
    source: sources.length > 1 ? 'mixed' : sources[0] ?? 'threads_search',
    sampledQueries: RADAR_SAMPLE_QUERIES.length,
    sampledCandidates: texts.length,
    errors
  }
}

async function fetchRadarCandidates(db: AppDatabase, query: string) {
  try {
    return await searchThreadsWithPlaywright(db, query, CANDIDATES_PER_QUERY)
  } catch {
    return await fetchThreadsSearchCandidates(query, CANDIDATES_PER_QUERY)
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
