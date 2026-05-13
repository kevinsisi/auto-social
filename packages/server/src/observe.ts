import type { AppDatabase } from './db.js'
import { SENTIMENT_CLASSES, type ScamSignal, type Sentiment, type SponsoredSignal } from './ai/types.js'
import { cleanThreadsExcerptForDisplay, isKeywordRelevant } from './threads-bot/search.js'

const WINDOW_HOURS = 24
const MAX_POSTS = 50

export type SentimentBucket = { count: number; pct: number }

export type ObservedDraft = {
  variantIdx: number
  angle: string
  text: string
  length: number
}

export type ObservedVideo = {
  src: string
  poster: string | null
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
  videos: ObservedVideo[]
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
  images_json: string | null
  videos_json: string | null
  fetched_at: string
  pipeline_status: string
  pipeline_error: string | null
  classify_json: string | null
  sponsored_json: string | null
  scam_json: string | null
  score_json: string | null
  draft_variants_json: string | null
}

const HIGHLIGHT_LIMIT = 3
const HIGHLIGHT_MIN_ENGAGEMENT = 50

export function getKeywordObservation(db: AppDatabase, cardId: string, now: Date = new Date()): KeywordObservation | null {
  const card = db.prepare('SELECT id, keyword FROM patrol_cards WHERE id = ?').get(cardId) as CardRow | undefined
  if (!card) return null

  const since = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const rows = db.prepare(`
    SELECT id, source, url, author, title, text, published_at, engagement_json, images_json, videos_json, fetched_at,
           pipeline_status, pipeline_error, classify_json, sponsored_json, scam_json, score_json, draft_variants_json
    FROM trend_candidates
    WHERE card_id = ? AND fetched_at >= ?
    ORDER BY fetched_at DESC
    LIMIT ?
  `).all(cardId, since, MAX_POSTS) as CandidateRow[]

  const posts = rows
    .filter((row) => isKeywordRelevant(`${row.title ?? ''} ${row.text}`, card.keyword))
    .map(toObservedPost)
  const aggregate = aggregate24h(posts, since)

  const byEngagement = [...posts].sort(byEngagementDesc)
  const highlightIds = new Set<string>()
  const highlights: ObservedPost[] = []
  for (const post of byEngagement) {
    if (highlights.length >= HIGHLIGHT_LIMIT) break
    if (engagementScore(post) < HIGHLIGHT_MIN_ENGAGEMENT) break
    highlights.push(post)
    highlightIds.add(post.id)
  }

  const tail = posts.filter((post) => !highlightIds.has(post.id)).sort(byRecencyDesc)

  return { card, aggregate, highlights, posts: tail }
}

function byRecencyDesc(a: ObservedPost, b: ObservedPost): number {
  return (b.postedAt ?? b.fetchedAt ?? '').localeCompare(a.postedAt ?? a.fetchedAt ?? '')
}

function engagementScore(post: ObservedPost): number {
  const likes = post.likes ?? 0
  const replies = post.replyCount ?? 0
  const reposts = post.reposts ?? 0
  const shares = post.shares ?? 0
  return likes + replies * 3 + reposts * 5 + shares * 2
}

function byEngagementDesc(a: ObservedPost, b: ObservedPost): number {
  const diff = engagementScore(b) - engagementScore(a)
  if (diff !== 0) return diff
  return (b.fetchedAt ?? '').localeCompare(a.fetchedAt ?? '')
}

function toObservedPost(row: CandidateRow): ObservedPost {
  const classify = parseJson(row.classify_json) as { topic?: string; sentiment?: Sentiment; voiceFit?: number } | null
  const sponsored = parseJson(row.sponsored_json) as { sponsoredSignal?: SponsoredSignal; reasons?: string[] } | null
  const scam = parseJson(row.scam_json) as { scamSignal?: ScamSignal; reasons?: string[] } | null
  const score = parseJson(row.score_json) as { shouldDraft?: boolean; reason?: string } | null
  const variants = parseJson(row.draft_variants_json) as Array<{ angle: string; text: string; length: number }> | null
  const engagement = parseJson(row.engagement_json) as { likes?: number | null; replies?: number | null; reposts?: number | null; shares?: number | null } | null
  const imagesRaw = parseJson(row.images_json)
  const images = Array.isArray(imagesRaw) ? imagesRaw.filter((src): src is string => typeof src === 'string') : []
  const videosRaw = parseJson(row.videos_json)
  const videos: ObservedVideo[] = Array.isArray(videosRaw)
    ? videosRaw
        .filter((v): v is { src: string; poster?: string | null } => Boolean(v) && typeof (v as { src?: unknown }).src === 'string')
        .map((v) => ({ src: v.src, poster: typeof v.poster === 'string' ? v.poster : null }))
    : []

  const firstVariant = variants && variants.length > 0 ? variants[0]! : null
  return {
    id: row.id,
    source: row.source,
    url: row.url,
    author: row.author,
    postedAt: row.published_at,
    likes: engagement?.likes ?? null,
    replyCount: engagement?.replies ?? null,
    reposts: engagement?.reposts ?? null,
    shares: engagement?.shares ?? null,
    excerpt: cleanExcerptForDisplay(row.text),
    images,
    videos,
    fetchedAt: row.fetched_at,
    pipelineStatus: row.pipeline_status,
    pipelineError: row.pipeline_error,
    topic: classify?.topic ?? null,
    sentiment: classify?.sentiment ?? null,
    voiceFit: classify?.voiceFit ?? null,
    sponsoredSignal: sponsored?.sponsoredSignal ?? null,
    sponsoredReasons: sponsored?.reasons ?? [],
    scamSignal: scam?.scamSignal ?? null,
    scamReasons: scam?.reasons ?? [],
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
  let scamCount = 0
  let pipelineBlockedCount = 0

  for (const post of posts) {
    if (post.pipelineStatus === 'pipeline_blocked') pipelineBlockedCount += 1
    if (post.sentiment) {
      distribution[post.sentiment].count += 1
      classifiedSamples += 1
    }
    if (post.sponsoredSignal && post.sponsoredSignal !== 'none') sponsoredCount += 1
    if (post.scamSignal && post.scamSignal !== 'none') scamCount += 1
  }

  for (const key of SENTIMENT_CLASSES) {
    const bucket = distribution[key]
    bucket.pct = classifiedSamples > 0 ? bucket.count / classifiedSamples : 0
  }

  const sponsoredEligible = posts.filter((post) => post.sponsoredSignal !== null).length
  const sponsoredRate = sponsoredEligible > 0 ? sponsoredCount / sponsoredEligible : 0
  const scamEligible = posts.filter((post) => post.scamSignal !== null).length
  const scamRate = scamEligible > 0 ? scamCount / scamEligible : 0

  return {
    totalSamples: posts.length,
    classifiedSamples,
    since,
    sentimentDistribution: distribution,
    sponsoredRate,
    scamRate,
    pipelineBlockedCount
  }
}

function emptyDistribution(): Record<Sentiment, SentimentBucket> {
  return Object.fromEntries(SENTIMENT_CLASSES.map((key) => [key, { count: 0, pct: 0 }])) as Record<Sentiment, SentimentBucket>
}

function cleanExcerptForDisplay(text: string): string {
  return cleanThreadsExcerptForDisplay(text)
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
