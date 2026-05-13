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
export type ScamSignal = 'none' | 'suspect' | 'likely'
export type FeedbackDecision = 'like' | 'dislike' | 'rewrite'

export type TaskType = 'pipeline' | 'compose_post' | 'image_gen'
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type AiTask = {
  id: string
  type: TaskType
  label: string
  status: TaskStatus
  attempts: number
  maxAttempts: number
  enqueuedAt: string
  claimedAt: string | null
  completedAt: string | null
  error: string | null
  nextRetryAt: string | null
}

export type QueueSnapshot = {
  countsByType: Record<TaskType, Record<TaskStatus, number>>
  inflight: AiTask[]
  recent: AiTask[]
}

export type SchedulerStatus = {
  enabled: boolean
  cadence: string
  running: boolean
  nextRunAt: string | null
  lastStatus: 'idle' | 'running' | 'completed' | 'failed' | 'skipped_overlap'
  lastStartedAt: string | null
  lastCompletedAt: string | null
  lastSkippedAt: string | null
  lastError: string | null
  lastCardCount: number
  lastInsertedCount: number
}

export type PostDraft = {
  id: string
  seedKeyword: string | null
  seedTopic: string | null
  angle: string | null
  text: string
  imagePrompt: string | null
  imagePath: string | null
  imageProvider: string | null
  imageError: string | null
  status: string
  createdAt: string
  decidedAt: string | null
  postedAt: string | null
  postedUrl: string | null
}

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
  reposts: number | null
  shares: number | null
  excerpt: string
  images: string[]
  videos: Array<{ src: string; poster: string | null }>
  fetchedAt: string
  pipelineStatus: string
  pipelineError: string | null
  topic: string | null
  sentiment: Sentiment | null
  voiceFit: number | null
  sponsoredSignal: SponsoredSignal | null
  sponsoredReasons: string[]
  scamSignal: ScamSignal | null
  scamReasons: string[]
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
    scamRate: number
    pipelineBlockedCount: number
  }
  highlights: ObservedPost[]
  posts: ObservedPost[]
}
