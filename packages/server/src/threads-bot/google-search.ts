import type { BrowserContext } from 'playwright'
import type { AppDatabase } from '../db.js'
import { createThreadsContext } from './browser.js'
import { cleanThreadsExcerptForDisplay, isKeywordRelevant, isRecentThreadsPost, isTaiwanRelevant, type ThreadsPlaywrightCandidate } from './search.js'

export type ScanProgressEvent =
  | { stage: 'google' }
  | { stage: 'post'; n: number; total: number }
  | { stage: 'done'; found: number }

const GOOGLE_TIMEOUT_MS = 25_000
const POST_TIMEOUT_MS = 12_000
const MAX_URLS_FROM_GOOGLE = 15
const DEFAULT_LIMIT = 6

export async function searchThreadsViaGoogle(
  db: AppDatabase,
  keyword: string,
  limit = DEFAULT_LIMIT,
  onProgress?: (event: ScanProgressEvent) => void
): Promise<ThreadsPlaywrightCandidate[]> {
  const trimmed = keyword.trim()
  if (!trimmed) throw new Error('關鍵字不可為空。')

  onProgress?.({ stage: 'google' })

  const context = await createThreadsContext(db)
  try {
    const googlePage = await context.newPage()
    const urls = await fetchGoogleThreadsUrls(googlePage, trimmed)
    await googlePage.close()

    const targetUrls = urls.slice(0, limit)
    if (targetUrls.length === 0) {
      onProgress?.({ stage: 'done', found: 0 })
      return []
    }

    onProgress?.({ stage: 'post', n: 0, total: targetUrls.length })

    const results: ThreadsPlaywrightCandidate[] = []
    for (let i = 0; i < targetUrls.length; i++) {
      onProgress?.({ stage: 'post', n: i + 1, total: targetUrls.length })
      try {
        const post = await scrapeThreadsPost(context, targetUrls[i])
        if (!post) continue
        if (!isRecentThreadsPost(post.postedAt)) continue
        if (!isTaiwanRelevant(post.excerpt, trimmed)) continue
        if (!isKeywordRelevant(`${post.title} ${post.excerpt}`, trimmed)) continue
        results.push(post)
      } catch {
        // skip individual post failures — don't block the rest
      }
    }

    onProgress?.({ stage: 'done', found: results.length })
    return results
  } finally {
    await context.close()
  }
}

async function fetchGoogleThreadsUrls(page: Awaited<ReturnType<BrowserContext['newPage']>>, keyword: string): Promise<string[]> {
  const query = `site:threads.net ${keyword}`
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-TW&num=20`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOOGLE_TIMEOUT_MS })
  await page.waitForTimeout(1_500)

  return page.evaluate((maxUrls: number) => {
    const found: string[] = []
    const seen = new Set<string>()
    const threadPostPattern = /^https:\/\/(www\.)?threads\.(net|com)\/@[^/?#\s]+\/post\/[A-Za-z0-9_-]+/
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const href = a.href
      if (!threadPostPattern.test(href)) continue
      const canonical = href.replace(/(\/post\/[A-Za-z0-9_-]+)(?:\/[^?#]*)?(?:[?#].*)?$/, '$1')
      if (!seen.has(canonical)) {
        seen.add(canonical)
        found.push(canonical)
      }
      if (found.length >= maxUrls) break
    }
    return found
  }, MAX_URLS_FROM_GOOGLE)
}

async function scrapeThreadsPost(context: BrowserContext, url: string): Promise<ThreadsPlaywrightCandidate | null> {
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: POST_TIMEOUT_MS })
    await page.waitForTimeout(800)

    if (page.url().includes('/login')) return null

    const data = await page.evaluate((postUrl: string) => {
      function parseCount(raw: string | null | undefined): number | null {
        if (!raw) return null
        const m = String(raw).replace(/\s+/g, '').match(/([\d,]+(?:\.\d+)?)(K|M|k|m|萬|千)?/)
        if (!m || !m[1]) return null
        const num = Number(m[1].replace(/,/g, ''))
        if (!Number.isFinite(num)) return null
        const unit = m[2] ?? ''
        if (unit === 'K' || unit === 'k' || unit === '千') return Math.round(num * 1000)
        if (unit === 'M' || unit === 'm') return Math.round(num * 1_000_000)
        if (unit === '萬') return Math.round(num * 10000)
        return Math.round(num)
      }

      function findCountByHint(root: Element, hintRegex: RegExp): number | null {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('[aria-label],[title]'))) {
          const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
          if (hintRegex.test(label)) {
            const n = parseCount(label)
            if (n !== null) return n
          }
        }
        return null
      }

      function findImages(root: Element): string[] {
        const out = new Set<string>()
        for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
          const src = img.currentSrc || img.src
          if (!src?.startsWith('https://')) continue
          if (!/cdninstagram\.com|fbcdn\.net/i.test(src)) continue
          const rect = img.getBoundingClientRect()
          if ((rect.width || img.naturalWidth || 0) < 120 || (rect.height || img.naturalHeight || 0) < 120) continue
          const alt = (img.getAttribute('alt') ?? '').toLowerCase()
          if (alt.includes('大頭貼') || alt.includes('profile picture') || alt.includes('verified')) continue
          out.add(src)
          if (out.size >= 6) break
        }
        return [...out]
      }

      function findVideos(root: Element): Array<{ src: string; poster: string | null }> {
        const out: Array<{ src: string; poster: string | null }> = []
        const seen = new Set<string>()
        for (const video of Array.from(root.querySelectorAll<HTMLVideoElement>('video'))) {
          let src = video.currentSrc || video.src
          if (!src) {
            for (const source of Array.from(video.querySelectorAll<HTMLSourceElement>('source'))) {
              if (source.src) { src = source.src; break }
            }
          }
          if (!src || (!src.startsWith('https://') && !src.startsWith('blob:'))) continue
          if (seen.has(src)) continue
          seen.add(src)
          out.push({ src, poster: video.getAttribute('poster') })
          if (out.length >= 4) break
        }
        return out
      }

      // Prefer the first article element (the post itself, not replies)
      const root: Element = document.querySelector('article') ?? document.querySelector('[role="article"]') ?? document.body
      const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text.length < 8) return null

      const urlMatch = postUrl.match(/@([^/?#\s]+)\/post\//)
      const author = urlMatch ? `@${urlMatch[1]}` : null
      const timeEl = document.querySelector<HTMLTimeElement>('time[datetime]')
      const postedAt = timeEl?.getAttribute('datetime') ?? null

      return {
        url: postUrl,
        text: text.slice(0, 600),
        author,
        postedAt,
        likes: findCountByHint(root, /like|讚/i),
        replyCount: findCountByHint(root, /repl|留言|comment/i),
        reposts: findCountByHint(root, /repost|轉發/i),
        shares: findCountByHint(root, /share|分享/i),
        images: findImages(root),
        videos: findVideos(root)
      }
    }, url)

    if (!data) return null

    const excerpt = cleanThreadsExcerptForDisplay(data.text)
    return {
      url: data.url,
      title: excerpt.slice(0, 80) || 'Threads 貼文',
      excerpt: excerpt.slice(0, 240),
      source: 'threads_playwright' as const,
      author: data.author,
      postedAt: data.postedAt,
      likes: data.likes,
      replyCount: data.replyCount,
      reposts: data.reposts,
      shares: data.shares,
      images: data.images,
      videos: data.videos
    }
  } finally {
    await page.close()
  }
}
