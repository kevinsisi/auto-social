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
  source: 'manual' | 'browser' | 'threads_search' | 'threads_playwright'
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

export type ThreadsSessionStatus = {
  configured: boolean
  hasSession: boolean
  healthy: boolean
  boundHandle: string | null
  lastLoginAt: string | null
  healthNote: string | null
}

export type ThreadsLoginJob = {
  id: string
  url: string
  vncUrl: string
  createdAt: string
  lastActivityAt: string
}

export type AdminSession = {
  configured: boolean
  authenticated: boolean
}

export type RadarTerm = {
  word: string
  count: number
}

export type RadarTrend = {
  terms: RadarTerm[]
  source: 'threads_playwright' | 'threads_search' | 'mixed'
  sampledQueries: number
  sampledCandidates: number
  errors: string[]
  scanRun?: {
    id: string
    status: 'completed' | 'failed'
    candidatesAdded: number
  }
}

export type Sentiment = 'anger' | 'complaint' | 'help' | 'sarcasm' | 'neutral' | 'positive' | 'support'
export type SponsoredSignal = 'none' | 'suspect' | 'likely'
export type FeedbackDecision = 'like' | 'dislike' | 'rewrite'

export type SentimentBucket = { count: number; pct: number }

export type ObservedDraft = {
  variantIdx: number
  angle: string
  text: string
  length: number
}

export type ObservedPost = {
  id: string
  source: string
  url: string
  author: string | null
  postedAt: string | null
  likes: number | null
  replyCount: number | null
  excerpt: string
  fetchedAt: string
  pipelineStatus: string
  pipelineError: string | null
  topic: string | null
  sentiment: Sentiment | null
  voiceFit: number | null
  sponsoredSignal: SponsoredSignal | null
  sponsoredReasons: string[]
  shouldDraft: boolean | null
  scoreReason: string | null
  draft: ObservedDraft | null
}

export type KeywordObservation = {
  card: { id: string; keyword: string }
  aggregate: {
    totalSamples: number
    classifiedSamples: number
    since: string
    sentimentDistribution: Record<Sentiment, SentimentBucket>
    sponsoredRate: number
    pipelineBlockedCount: number
  }
  posts: ObservedPost[]
}
