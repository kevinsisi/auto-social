import { nanoid } from 'nanoid'
import type { AppDatabase } from './db.js'
import { generateAnalysis } from './humor.js'
import { nowIso } from './time.js'
import type { ThreadsFallbackProvider } from './sources/threads-search.js'
import type { CandidateAnalysis, CandidateStatus, CandidateWithAnalysis, PatrolCard, PatrolCardDetail } from './types.js'

type CardRow = { id: string; keyword: string; created_at: string; updated_at: string; recent_sample_count: number; last_scan_at: string | null }
type CandidateRow = { id: string; card_id: string; run_id: string | null; url: string; title: string; excerpt: string; status: CandidateStatus; source: 'manual' | 'browser' | 'threads_search' | 'threads_playwright'; created_at: string }
type PatrolSourceCandidate = { url: string; title: string; excerpt: string; source: 'threads_search' | 'threads_playwright' }
type AnalysisRow = { candidate_id: string; summary: string; worth_replying: 0 | 1; reply_angle: string; risk_level: CandidateAnalysis['riskLevel']; risk_note: string; image_idea: string; meme_prompt: string }
type SuggestionRow = { id: string; candidate_id: string; tone: 'normal' | 'spicy'; label: '普通' | '比較酸'; text: string; risk_level: CandidateAnalysis['riskLevel']; risk_note: string }

export class PatrolRepository {
  constructor(private readonly db: AppDatabase) {}

  listCards(): PatrolCard[] {
    const rows = this.db.prepare(`
      SELECT c.*,
        COUNT(ca.id) AS recent_sample_count,
        MAX(pr.completed_at) AS last_scan_at
      FROM patrol_cards c
      LEFT JOIN candidates ca
        ON ca.card_id = c.id
        AND ca.created_at >= datetime('now', '-24 hours')
      LEFT JOIN patrol_runs pr
        ON pr.card_id = c.id
        AND pr.status = 'completed'
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `).all() as CardRow[]
    return rows.map(mapCard)
  }

  createCard(keyword: string): PatrolCard {
    const trimmedKeyword = keyword.trim()
    if (!trimmedKeyword) {
      throw new Error('請先輸入關鍵字，海巡小隊不能靠意念出勤。')
    }

    const timestamp = nowIso()
    const card: PatrolCard = {
      id: nanoid(),
      keyword,
      createdAt: timestamp,
      updatedAt: timestamp,
      recentSampleCount: 0,
      lastScanAt: null,
    }

    this.db.prepare('INSERT INTO patrol_cards (id, keyword, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(card.id, card.keyword, card.createdAt, card.updatedAt)
    return card
  }

  deleteCard(cardId: string): boolean {
    const result = this.db.prepare('DELETE FROM patrol_cards WHERE id = ?').run(cardId)
    if (result.changes === 0) return false
    this.db.prepare('DELETE FROM trend_candidates WHERE card_id = ?').run(cardId)
    return true
  }

  getCardDetail(cardId: string): PatrolCardDetail | null {
    const cardRow = this.db.prepare('SELECT * FROM patrol_cards WHERE id = ?').get(cardId) as CardRow | undefined
    if (!cardRow) return null

    const runs = this.db.prepare('SELECT id, card_id as cardId, status, message, created_at as createdAt, completed_at as completedAt FROM patrol_runs WHERE card_id = ? ORDER BY created_at DESC').all(cardId)
    const candidates = (this.db.prepare('SELECT * FROM candidates WHERE card_id = ? ORDER BY created_at DESC').all(cardId) as CandidateRow[])
      .map((candidate) => ({ ...mapCandidate(candidate), analysis: this.getAnalysis(candidate.id) }))

    return { ...mapCard(cardRow), runs: runs as PatrolCardDetail['runs'], candidates }
  }

  addManualCandidate(cardId: string, url: string, title = '', excerpt = ''): CandidateWithAnalysis {
    const card = this.getCardDetail(cardId)
    if (!card) throw new Error('找不到這張海巡卡。')
    if (!isThreadsUrl(url)) throw new Error('請貼 Threads 連結，其他地方我們先不要海巡到迷路。')

    const id = nanoid()
    const createdAt = nowIso()
    this.db.prepare(`
      INSERT OR IGNORE INTO candidates (id, card_id, run_id, url, title, excerpt, status, source, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, 'needs_follow_up', 'manual', ?)
    `).run(id, cardId, url.trim(), title.trim(), excerpt.trim(), createdAt)

    const row = this.db.prepare('SELECT * FROM candidates WHERE card_id = ? AND url = ?').get(cardId, url.trim()) as CandidateRow
    const analysis = generateAnalysis(row.id, card.keyword, row.url, row.title, row.excerpt)
    this.saveAnalysis(analysis)
    this.touchCard(cardId)

    return { ...mapCandidate(row), analysis }
  }

  updateCandidateStatus(candidateId: string, status: CandidateStatus): CandidateWithAnalysis | null {
    this.db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run(status, candidateId)
    const row = this.db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as CandidateRow | undefined
    return row ? { ...mapCandidate(row), analysis: this.getAnalysis(candidateId) } : null
  }

  createThreadsSearchRun(
    cardId: string,
    items: PatrolSourceCandidate[],
    outcome: {
      outcomeKind?: 'playwright_ok' | 'fallback_ok' | 'no_matching_threads_results' | 'search_provider_blocked'
      providerUsed?: 'threads_playwright' | ThreadsFallbackProvider | null
      blockedProviders?: ThreadsFallbackProvider[]
      primaryError?: Error | null
    } = {}
  ) {
    const card = this.getCardDetail(cardId)
    if (!card) throw new Error('找不到這張海巡卡。')

    const runId = nanoid()
    const timestamp = nowIso()
    const inserted: CandidateWithAnalysis[] = []
    this.db.prepare(`
      INSERT INTO patrol_runs (id, card_id, status, message, created_at, completed_at)
      VALUES (?, ?, 'running', NULL, ?, NULL)
    `).run(runId, cardId, timestamp)

    const insertCandidate = this.db.prepare(`
      INSERT OR IGNORE INTO candidates (id, card_id, run_id, url, title, excerpt, status, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'needs_follow_up', ?, ?)
    `)

    for (const item of items) {
      const candidateId = nanoid()
      const result = insertCandidate.run(candidateId, cardId, runId, item.url, item.title, item.excerpt, item.source, timestamp)
      if (result.changes === 0) continue
      const row = this.db.prepare('SELECT * FROM candidates WHERE card_id = ? AND url = ?').get(cardId, item.url) as CandidateRow
      const analysis = generateAnalysis(row.id, card.keyword, row.url, row.title, row.excerpt)
      this.saveAnalysis(analysis)
      inserted.push({ ...mapCandidate(row), analysis })
    }

    const message = buildThreadsRunMessage(card.keyword, inserted.length, outcome)

    this.db.prepare('UPDATE patrol_runs SET status = ?, message = ?, completed_at = ? WHERE id = ?').run('completed', message, timestamp, runId)
    this.touchCard(cardId)

    return { id: runId, cardId, status: 'completed' as const, message, createdAt: timestamp, completedAt: timestamp, inserted }
  }

  private saveAnalysis(analysis: CandidateAnalysis) {
    this.db.prepare(`
      INSERT OR REPLACE INTO analyses (candidate_id, summary, worth_replying, reply_angle, risk_level, risk_note, image_idea, meme_prompt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(analysis.candidateId, analysis.summary, analysis.worthReplying ? 1 : 0, analysis.replyAngle, analysis.riskLevel, analysis.riskNote, analysis.imageIdea, analysis.memePrompt, nowIso())

    const insertSuggestion = this.db.prepare(`
      INSERT OR REPLACE INTO reply_suggestions (id, candidate_id, tone, label, text, risk_level, risk_note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const suggestion of analysis.suggestions) {
      insertSuggestion.run(suggestion.id, suggestion.candidateId, suggestion.tone, suggestion.label, suggestion.text, suggestion.riskLevel, suggestion.riskNote)
    }
  }

  private getAnalysis(candidateId: string): CandidateAnalysis | null {
    const row = this.db.prepare('SELECT * FROM analyses WHERE candidate_id = ?').get(candidateId) as AnalysisRow | undefined
    if (!row) return null
    const suggestions = this.db.prepare('SELECT * FROM reply_suggestions WHERE candidate_id = ? ORDER BY tone').all(candidateId) as SuggestionRow[]
    return {
      candidateId: row.candidate_id,
      summary: row.summary,
      worthReplying: row.worth_replying === 1,
      replyAngle: row.reply_angle,
      riskLevel: row.risk_level,
      riskNote: row.risk_note,
      imageIdea: row.image_idea,
      memePrompt: row.meme_prompt,
      suggestions: suggestions.map((suggestion) => ({
        id: suggestion.id,
        candidateId: suggestion.candidate_id,
        tone: suggestion.tone,
        label: suggestion.label,
        text: suggestion.text,
        riskLevel: suggestion.risk_level,
        riskNote: suggestion.risk_note
      }))
    }
  }

  private touchCard(cardId: string) {
    this.db.prepare('UPDATE patrol_cards SET updated_at = ? WHERE id = ?').run(nowIso(), cardId)
  }
}

export function isThreadsUrl(url: string) {
  try {
    const parsed = new URL(url)
    return ['www.threads.net', 'threads.net', 'www.threads.com', 'threads.com'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function mapCard(row: CardRow): PatrolCard {
  return {
    id: row.id,
    keyword: row.keyword,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recentSampleCount: row.recent_sample_count ?? 0,
    lastScanAt: row.last_scan_at ?? null,
  }
}

type ThreadsRunOutcomeMeta = {
  outcomeKind?: 'playwright_ok' | 'fallback_ok' | 'no_matching_threads_results' | 'search_provider_blocked'
  providerUsed?: 'threads_playwright' | ThreadsFallbackProvider | null
  blockedProviders?: ThreadsFallbackProvider[]
  primaryError?: Error | null
}

function buildThreadsRunMessage(keyword: string, insertedCount: number, outcome: ThreadsRunOutcomeMeta): string {
  const { outcomeKind, providerUsed, blockedProviders } = outcome
  if (outcomeKind === 'fallback_ok' && insertedCount > 0) {
    const providerLabel = formatSearchProvider(providerUsed)
    return `已使用 ${providerLabel} site:threads.net/site:threads.com 搜尋，找到 ${insertedCount} 筆候選。`
  }
  if (outcomeKind === 'search_provider_blocked') {
    const blockedList = (blockedProviders ?? []).map(formatSearchProvider).join('、')
    return blockedList
      ? `Threads 搜尋（${blockedList}）被阻擋或無法使用，請稍後再試。`
      : 'Threads 搜尋無法使用，請稍後再試。'
  }
  if (outcomeKind === 'no_matching_threads_results') {
    return `Threads 海巡完成，備援搜尋未找到「${keyword}」相關的 Threads 貼文。`
  }
  if (insertedCount === 0) {
    return `Threads 海巡完成，但沒有找到「${keyword}」新的相關結果。`
  }
  return `Threads 海巡完成，找到 ${insertedCount} 筆候選。`
}

function formatSearchProvider(provider: ThreadsRunOutcomeMeta['providerUsed']) {
  if (provider === 'brave') return 'Brave Search API'
  if (provider === 'duckduckgo_browser') return 'DuckDuckGo Browser'
  if (provider === 'bing') return 'Bing'
  if (provider === 'google') return 'Google'
  if (provider === 'duckduckgo') return 'DuckDuckGo'
  if (provider === 'duckduckgo_lite') return 'DuckDuckGo Lite'
  return '搜尋引擎'
}

function mapCandidate(row: CandidateRow): CandidateWithAnalysis {
  return {
    id: row.id,
    cardId: row.card_id,
    runId: row.run_id,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    analysis: null
  }
}
