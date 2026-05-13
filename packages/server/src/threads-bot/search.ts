import type { AppDatabase } from '../db.js'
import { createThreadsContext } from './browser.js'
import { markThreadsSessionUnhealthy } from './session.js'
import { gate, type GateOptions } from './throttle.js'

export type ThreadsVideo = {
  src: string
  poster: string | null
}

export type ThreadsPlaywrightCandidate = {
  url: string
  title: string
  excerpt: string
  source: 'threads_playwright'
  author: string | null
  postedAt: string | null
  likes: number | null
  replyCount: number | null
  reposts: number | null
  shares: number | null
  images: string[]
  videos: ThreadsVideo[]
}

const DEFAULT_LIMIT = 10
const SEARCH_TIMEOUT_MS = 30_000

export class ThreadsSearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThreadsSearchError'
  }
}

export function isTaiwanRelevant(text: string, _query: string): boolean {
  const cleaned = text.replace(/\s/g, '')
  if (cleaned.length < 8) return true
  const chineseChars = (cleaned.match(/[一-鿿]/g) ?? []).length
  const asciiLetters = (cleaned.match(/[a-zA-Z]/g) ?? []).length
  const japaneseKana = (cleaned.match(/[぀-ヿ]/g) ?? []).length
  const koreanChars = (cleaned.match(/[가-힯]/g) ?? []).length
  if (japaneseKana > chineseChars) return false
  if (koreanChars > chineseChars) return false
  if (asciiLetters > chineseChars * 2 && asciiLetters > 30) return false
  if (chineseChars === 0 && asciiLetters > 15) return false
  return true
}

export function cleanThreadsExcerptForDisplay(text: string): string {
  let cleaned = text
  cleaned = cleaned.replace(/^追蹤[A-Za-z0-9_.]+\s*/u, '')
  cleaned = cleaned.replace(/\s*\d+\s*(秒|分鐘|分|小時|時|天|週|月|年)\s*(以前)?\s*更多/gu, '')
  cleaned = cleaned.replace(/\s*\d+\s*(秒|分鐘|分|小時|時|天|週|月|年)\s*(以前)?/gu, ' ')
  cleaned = cleaned.replace(/更多|翻譯|靜音|編輯/gu, ' ')
  cleaned = cleaned.replace(/\d+\s*\/\s*\d+\s*讚\s*[\d.,KMkm萬千]+(?:\s*(?:留言|回覆|轉發|分\s*享|分享|享)\s*[\d.,KMkm萬千]+)*/gu, '')
  cleaned = cleaned.replace(/(?:讚|留言|回覆|轉發|分\s*享|分享|享)\s*[\d.,KMkm萬千]+/gu, '')
  cleaned = cleaned.replace(/[\d.,KMkm萬千]+\s*(?:則|個)?\s*(?:讚|留言|回覆|轉發|分\s*享|分享|享)/gu, '')
  cleaned = cleaned.replace(/(^|\s)(?:讚|留言|回覆|轉發|分\s*享|分享)(?=\s|$)/gu, ' ')
  return cleaned.replace(/\s+/g, ' ').trim()
}

export async function searchThreadsWithPlaywright(db: AppDatabase, keyword: string, limit = DEFAULT_LIMIT, throttleOptions: GateOptions = {}): Promise<ThreadsPlaywrightCandidate[]> {
  const trimmed = keyword.trim()
  if (!trimmed) throw new ThreadsSearchError('Threads 搜尋關鍵字不可為空。')

  await gate(db, 'search', throttleOptions)

  const context = await createThreadsContext(db)
  const page = await context.newPage()
  try {
    const url = `https://www.threads.com/search?q=${encodeURIComponent(trimmed)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS })
    await page.waitForTimeout(2_000)
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(1_000)

    const currentUrl = page.url()
    if (currentUrl.includes('/login')) {
      markThreadsSessionUnhealthy(db, 'Threads 要求重新登入。')
      throw new ThreadsSearchError('Threads session 已失效或尚未登入。')
    }

    const items = await page.evaluate((maxResults) => {
      function parseCount(raw: string | null | undefined): number | null {
        if (!raw) return null
        const cleaned = String(raw).replace(/\s+/g, ' ').trim()
        const match = cleaned.match(/([\d,]+(?:\.\d+)?)\s*(K|M|k|m|萬|千)?/)
        if (!match || !match[1]) return null
        const num = Number(match[1].replace(/,/g, ''))
        if (!Number.isFinite(num)) return null
        const unit = match[2] ?? ''
        if (unit === 'K' || unit === 'k' || unit === '千') return Math.round(num * 1000)
        if (unit === 'M' || unit === 'm') return Math.round(num * 1_000_000)
        if (unit === '萬') return Math.round(num * 10000)
        return Math.round(num)
      }

      function findAuthor(container: Element): string | null {
        for (const link of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
          const href = link.getAttribute('href') ?? ''
          const match = href.match(/^(?:https:\/\/(?:www\.)?threads\.(?:net|com))?\/@([^/?#\s]+)\/?$/)
          if (match && match[1]) return `@${match[1]}`
        }
        return null
      }

      function findPostedAt(container: Element): string | null {
        const timeEl = container.querySelector<HTMLTimeElement>('time[datetime]')
        return timeEl?.getAttribute('datetime') ?? null
      }

      function findCountByHint(container: Element, hintRegex: RegExp): number | null {
        for (const el of Array.from(container.querySelectorAll<HTMLElement>('[aria-label], [title]'))) {
          const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
          if (hintRegex.test(label)) {
            const n = parseCount(label)
            if (n !== null) return n
          }
        }
        return null
      }

      function findCountByText(text: string, labelRegex: RegExp): number | null {
        const compact = text.replace(/\s+/g, '')
        const units = '[\\d,]+(?:\\.\\d+)?(?:K|M|k|m|萬|千)?'
        const labelThenCount = new RegExp(`(?:${labelRegex.source})(${units})`, 'iu')
        const countThenLabel = new RegExp(`(${units})(?:則|個)?(?:${labelRegex.source})`, 'iu')
        return parseCount(compact.match(labelThenCount)?.[1]) ?? parseCount(compact.match(countThenLabel)?.[1])
      }

      function findCount(container: Element, text: string, hintRegex: RegExp, labelRegex: RegExp): number | null {
        return findCountByHint(container, hintRegex) ?? findCountByText(text, labelRegex)
      }

      function cleanExcerpt(text: string): string {
        let cleaned = text
        cleaned = cleaned.replace(/^追蹤[A-Za-z0-9_.]+\s*/u, '')
        cleaned = cleaned.replace(/\s*\d+\s*(秒|分鐘|分|小時|時|天|週|月|年)\s*(以前)?\s*更多/gu, '')
        cleaned = cleaned.replace(/\s*\d+\s*(秒|分鐘|分|小時|時|天|週|月|年)\s*(以前)?/gu, ' ')
        cleaned = cleaned.replace(/更多|翻譯|靜音|編輯/gu, ' ')
        cleaned = cleaned.replace(/\d+\s*\/\s*\d+\s*讚\s*[\d.,KMkm萬千]+(?:\s*(?:留言|回覆|轉發|分\s*享|分享|享)\s*[\d.,KMkm萬千]+)*/gu, '')
        cleaned = cleaned.replace(/(?:讚|留言|回覆|轉發|分\s*享|分享|享)\s*[\d.,KMkm萬千]+/gu, '')
        cleaned = cleaned.replace(/[\d.,KMkm萬千]+\s*(?:則|個)?\s*(?:讚|留言|回覆|轉發|分\s*享|分享|享)/gu, '')
        cleaned = cleaned.replace(/(^|\s)(?:讚|留言|回覆|轉發|分\s*享|分享)(?=\s|$)/gu, ' ')
        return cleaned.replace(/\s+/g, ' ').trim()
      }

      function findImages(container: Element): string[] {
        const out = new Set<string>()
        for (const img of Array.from(container.querySelectorAll<HTMLImageElement>('img'))) {
          const src = img.currentSrc || img.src
          if (!src || !src.startsWith('https://')) continue
          if (!/cdninstagram\.com|fbcdn\.net/i.test(src)) continue
          const rect = img.getBoundingClientRect()
          const width = rect.width || img.naturalWidth || 0
          const height = rect.height || img.naturalHeight || 0
          if (width < 120 || height < 120) continue
          const alt = (img.getAttribute('alt') ?? '').toLowerCase()
          if (alt.includes('大頭貼') || alt.includes('profile picture') || alt.includes('verified')) continue
          if (img.closest('a[href^="/@"]') || img.closest('a[href^="https://www.threads."][href*="/@"]')) {
            const ancestor = img.closest('a[href*="/@"]') as HTMLAnchorElement | null
            if (ancestor && !ancestor.href.includes('/post/')) continue
          }
          out.add(src)
          if (out.size >= 6) break
        }
        return [...out]
      }

      function findVideos(container: Element): Array<{ src: string; poster: string | null }> {
        const out: Array<{ src: string; poster: string | null }> = []
        const seen = new Set<string>()
        for (const video of Array.from(container.querySelectorAll<HTMLVideoElement>('video'))) {
          let src = video.currentSrc || video.src
          if (!src) {
            for (const source of Array.from(video.querySelectorAll<HTMLSourceElement>('source'))) {
              if (source.src) { src = source.src; break }
            }
          }
          if (!src || !src.startsWith('https://') && !src.startsWith('blob:')) continue
          if (seen.has(src)) continue
          seen.add(src)
          out.push({ src, poster: video.getAttribute('poster') })
          if (out.length >= 4) break
        }
        return out
      }

      const threadsHostPattern = /^https:\/\/(www\.)?threads\.(net|com)\//i
      const seen = new Set<string>()
      const results: Array<{ url: string; title: string; excerpt: string; author: string | null; postedAt: string | null; likes: number | null; replyCount: number | null; reposts: number | null; shares: number | null; images: string[]; videos: Array<{ src: string; poster: string | null }> }> = []
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = anchor.href
        if (!threadsHostPattern.test(href)) continue
        if (href.includes('/search?') || href.includes('/privacy') || href.includes('/login')) continue
        if (!href.includes('/post/')) continue
        const canonical = href.replace(/(\/post\/[A-Za-z0-9_-]+)(?:\/[^?#]*)?(?:[?#].*)?$/, '$1')
        const normalized = canonical
        if (seen.has(normalized)) continue
        let container: Element | null = anchor.closest('article') ?? anchor.closest('[role="article"]') ?? anchor.parentElement
        let bestContainer: Element | null = container
        let text = ''
        for (let depth = 0; container && depth < 8; depth += 1) {
          const candidateText = (container.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (candidateText.length > text.length && candidateText.length < 1200) {
            text = candidateText
            bestContainer = container
          }
          container = container.parentElement
        }
        if (text.length < 8) continue
        seen.add(normalized)
        const ctx = bestContainer ?? anchor.parentElement
        const likes = ctx ? findCount(ctx, text, /like|讚/i, /讚/) : null
        const replyCount = ctx ? findCount(ctx, text, /repl|留言|comment/i, /留言|回覆/) : null
        const reposts = ctx ? findCount(ctx, text, /repost|轉發/i, /轉發/) : null
        const shares = ctx ? findCount(ctx, text, /share|分享/i, /分享|享/) : null
        const cleanedExcerpt = cleanExcerpt(text)
        results.push({
          url: normalized,
          title: cleanedExcerpt.slice(0, 80) || 'Threads 搜尋結果',
          excerpt: cleanedExcerpt.slice(0, 240),
          author: ctx ? findAuthor(ctx) : null,
          postedAt: ctx ? findPostedAt(ctx) : null,
          likes,
          replyCount,
          reposts,
          shares,
          images: ctx ? findImages(ctx) : [],
          videos: ctx ? findVideos(ctx) : []
        })
        if (results.length >= maxResults) break
      }
      return results
    }, limit)

    const localeFiltered = items.filter((item) => isTaiwanRelevant(item.excerpt, trimmed))
    return localeFiltered.map((item) => ({ ...item, source: 'threads_playwright' as const }))
  } catch (error) {
    if (error instanceof ThreadsSearchError) throw error
    throw new ThreadsSearchError(error instanceof Error ? error.message : 'Threads Playwright 搜尋失敗。')
  } finally {
    await context.close()
  }
}
