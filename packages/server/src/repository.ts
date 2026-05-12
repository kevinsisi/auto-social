import { nanoid } from 'nanoid'
import type { AppDatabase } from './db.js'
import { generateAnalysis } from './humor.js'
import { nowIso } from './time.js'
import type { CandidateAnalysis, CandidateStatus, CandidateWithAnalysis, PatrolCard, PatrolCardDetail } from './types.js'

type CardRow = { id: string; keyword: string; created_at: string; updated_at: string }
type CandidateRow = { id: string; card_id: string; run_id: string | null; url: string; title: string; excerpt: string; status: CandidateStatus; source: 'manual' | 'browser' | 'threads_search'; created_at: string }
type PatrolSourceCandidate = { url: string; title: string; excerpt: string; source: 'threads_search' }
type AnalysisRow = { candidate_id: string; summary: string; worth_replying: 0 | 1; reply_angle: string; risk_level: CandidateAnalysis['riskLevel']; risk_note: string; image_idea: string; meme_prompt: string }
type SuggestionRow = { id: string; candidate_id: string; tone: 'normal' | 'spicy'; label: '普通' | '比較酸'; text: string; risk_level: CandidateAnalysis['riskLevel']; risk_note: string }

export class PatrolRepository {
  constructor(private readonly db: AppDatabase) {}

  listCards(): PatrolCard[] {
    const rows = this.db.prepare('SELECT * FROM patrol_cards ORDER BY updated_at DESC').all() as CardRow[]
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
      updatedAt: timestamp
    }

    this.db.prepare('INSERT INTO patrol_cards (id, keyword, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(card.id, card.keyword, card.createdAt, card.updatedAt)
    return card
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

  createBrowserRun(cardId: string) {
    const card = this.getCardDetail(cardId)
    if (!card) throw new Error('找不到這張海巡卡。')
    const id = nanoid()
    const timestamp = nowIso()
    const searchUrl = `https://www.threads.net/search?q=${encodeURIComponent(card.keyword)}`

    this.db.prepare(`
      INSERT INTO patrol_runs (id, card_id, status, message, created_at, completed_at)
      VALUES (?, ?, 'failed', ?, ?, ?)
    `).run(id, cardId, `已準備開啟 Threads 搜尋頁：${searchUrl}。目前 MVP 不儲存帳號，也不保證能自動讀取 Threads Web。`, timestamp, timestamp)
    this.touchCard(cardId)
    return { id, cardId, status: 'failed' as const, message: `請手動確認 Threads 搜尋頁：${searchUrl}`, createdAt: timestamp, completedAt: timestamp, searchUrl }
  }

  createThreadsSearchRun(cardId: string, items: PatrolSourceCandidate[]) {
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

    const message = inserted.length > 0
      ? `Threads 海巡完成，找到 ${inserted.length} 筆候選。`
      : `Threads 海巡完成，但沒有找到「${card.keyword}」新的相關結果。`

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
    return parsed.hostname === 'www.threads.net' || parsed.hostname === 'threads.net'
  } catch {
    return false
  }
}

function mapCard(row: CardRow): PatrolCard {
  return { id: row.id, keyword: row.keyword, createdAt: row.created_at, updatedAt: row.updated_at }
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
