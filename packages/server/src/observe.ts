import type { AppDatabase } from './db.js'
import { SENTIMENT_CLASSES, type Sentiment, type SponsoredSignal } from './ai/types.js'

const WINDOW_HOURS = 24
const MAX_POSTS = 50

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

type CardRow = { id: string; keyword: string }

type CandidateRow = {
  id: string
  source: string
  url: string
  author: string | null
  title: string | null
  text: string
  published_at: string | null
  engagement_json: string | null
  fetched_at: string
  pipeline_status: string
  pipeline_error: string | null
  classify_json: string | null
  sponsored_json: string | null
  score_json: string | null
  draft_variants_json: string | null
}

export function getKeywordObservation(db: AppDatabase, cardId: string, now: Date = new Date()): KeywordObservation | null {
  const card = db.prepare('SELECT id, keyword FROM patrol_cards WHERE id = ?').get(cardId) as CardRow | undefined
  if (!card) return null

  const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const rows = db.prepare(`
    SELECT id, source, url, author, title, text, published_at, engagement_json, fetched_at,
           pipeline_status, pipeline_error, classify_json, sponsored_json, score_json, draft_variants_json
    FROM trend_candidates
    WHERE card_id = ? AND fetched_at >= ?
    ORDER BY fetched_at DESC
    LIMIT ?
  `).all(cardId, since, MAX_POSTS) as CandidateRow[]

  const posts = rows.map(toObservedPost)
  const aggregate = aggregate24h(posts, since)

  return { card, aggregate, posts }
}

function toObservedPost(row: CandidateRow): ObservedPost {
  const classify = parseJson(row.classify_json) as { topic?: string; sentiment?: Sentiment; voiceFit?: number } | null
  const sponsored = parseJson(row.sponsored_json) as { sponsoredSignal?: SponsoredSignal; reasons?: string[] } | null
  const score = parseJson(row.score_json) as { shouldDraft?: boolean; reason?: string } | null
  const variants = parseJson(row.draft_variants_json) as Array<{ angle: string; text: string; length: number }> | null
  const engagement = parseJson(row.engagement_json) as { likes?: number | null; replies?: number | null } | null

  const firstVariant = variants && variants.length > 0 ? variants[0]! : null
  return {
    id: row.id,
    source: row.source,
    url: row.url,
    author: row.author,
    postedAt: row.published_at,
    likes: engagement?.likes ?? null,
    replyCount: engagement?.replies ?? null,
    excerpt: row.text,
    fetchedAt: row.fetched_at,
    pipelineStatus: row.pipeline_status,
    pipelineError: row.pipeline_error,
    topic: classify?.topic ?? null,
    sentiment: classify?.sentiment ?? null,
    voiceFit: classify?.voiceFit ?? null,
    sponsoredSignal: sponsored?.sponsoredSignal ?? null,
    sponsoredReasons: sponsored?.reasons ?? [],
    shouldDraft: score?.shouldDraft ?? null,
    scoreReason: score?.reason ?? null,
    draft: firstVariant
      ? { variantIdx: 0, angle: firstVariant.angle, text: firstVariant.text, length: firstVariant.length ?? firstVariant.text.length }
      : null
  }
}

function aggregate24h(posts: ObservedPost[], since: string) {
  const distribution = emptyDistribution()
  let classifiedSamples = 0
  let sponsoredCount = 0
  let pipelineBlockedCount = 0

  for (const post of posts) {
    if (post.pipelineStatus === 'pipeline_blocked') pipelineBlockedCount += 1
    if (post.sentiment) {
      distribution[post.sentiment].count += 1
      classifiedSamples += 1
    }
    if (post.sponsoredSignal && post.sponsoredSignal !== 'none') sponsoredCount += 1
  }

  for (const key of SENTIMENT_CLASSES) {
    const bucket = distribution[key]
    bucket.pct = classifiedSamples > 0 ? bucket.count / classifiedSamples : 0
  }

  const sponsoredEligible = posts.filter((post) => post.sponsoredSignal !== null).length
  const sponsoredRate = sponsoredEligible > 0 ? sponsoredCount / sponsoredEligible : 0

  return {
    totalSamples: posts.length,
    classifiedSamples,
    since,
    sentimentDistribution: distribution,
    sponsoredRate,
    pipelineBlockedCount
  }
}

function emptyDistribution(): Record<Sentiment, SentimentBucket> {
  return Object.fromEntries(SENTIMENT_CLASSES.map((key) => [key, { count: 0, pct: 0 }])) as Record<Sentiment, SentimentBucket>
}

function parseJson(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export type VoiceFeedbackInput = {
  draftId: string
  variantIdx: number
  decision: 'like' | 'dislike' | 'rewrite'
  comment?: string | null
}

export function saveVoiceFeedback(db: AppDatabase, input: VoiceFeedbackInput, now: Date = new Date()) {
  const id = `${input.draftId}:${input.variantIdx}:${input.decision}:${now.getTime()}`
  db.prepare(`
    INSERT INTO voice_feedback (id, draft_id, variant_idx, decision, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.draftId, input.variantIdx, input.decision, input.comment ?? null, now.toISOString())
  return { id, createdAt: now.toISOString() }
}
