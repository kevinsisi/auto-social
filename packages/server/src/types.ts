export type PatrolStatus = 'pending' | 'running' | 'completed' | 'failed'
export type CandidateStatus = 'useful' | 'ignored' | 'replied' | 'needs_follow_up'
export type RiskLevel = 'low' | 'medium' | 'high'

export type PatrolCard = {
  id: string
  keyword: string
  createdAt: string
  updatedAt: string
  recentSampleCount: number
  lastScanAt: string | null
}

export type PatrolRun = {
  id: string
  cardId: string
  status: PatrolStatus
  message: string | null
  createdAt: string
  completedAt: string | null
}

export type Candidate = {
  id: string
  cardId: string
  runId: string | null
  url: string
  title: string
  excerpt: string
  status: CandidateStatus
  source: 'manual' | 'browser' | 'threads_search' | 'threads_playwright'
  createdAt: string
}

export type ReplySuggestion = {
  id: string
  candidateId: string
  tone: 'normal' | 'spicy'
  label: '普通' | '比較酸'
  text: string
  riskLevel: RiskLevel
  riskNote: string
}

export type CandidateAnalysis = {
  candidateId: string
  summary: string
  worthReplying: boolean
  replyAngle: string
  riskLevel: RiskLevel
  riskNote: string
  imageIdea: string
  memePrompt: string
  suggestions: ReplySuggestion[]
}

export type CandidateWithAnalysis = Candidate & {
  analysis: CandidateAnalysis | null
}

export type PatrolCardDetail = PatrolCard & {
  runs: PatrolRun[]
  candidates: CandidateWithAnalysis[]
}
