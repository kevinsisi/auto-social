export type RiskLevel = 'low' | 'medium' | 'high'
export type CandidateStatus = 'useful' | 'ignored' | 'replied' | 'needs_follow_up'

export type PatrolCard = {
  id: string
  keyword: string
  createdAt: string
  updatedAt: string
}

export type ReplySuggestion = {
  id: string
  label: '普通' | '比較酸'
  text: string
  riskLevel: RiskLevel
  riskNote: string
}

export type CandidateAnalysis = {
  summary: string
  worthReplying: boolean
  replyAngle: string
  riskLevel: RiskLevel
  riskNote: string
  imageIdea: string
  memePrompt: string
  suggestions: ReplySuggestion[]
}

export type Candidate = {
  id: string
  url: string
  title: string
  excerpt: string
  status: CandidateStatus
  source: 'manual' | 'browser'
  createdAt: string
  analysis: CandidateAnalysis | null
}

export type PatrolRun = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  message: string | null
  createdAt: string
  completedAt: string | null
}

export type PatrolCardDetail = PatrolCard & {
  runs: PatrolRun[]
  candidates: Candidate[]
}

export type KeyStatus = {
  id: number
  suffix: string
  health: 'available' | 'cooldown' | 'leased' | 'inactive'
  isActive: boolean
  cooldownUntil: number
  leaseUntil: number
  usageCount: number
}
