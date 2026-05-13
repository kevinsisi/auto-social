import type { AppDatabase } from '../db.js'
import { createThreadsContext } from './browser.js'
import { markThreadsSessionUnhealthy } from './session.js'
import { gate, type GateOptions } from './throttle.js'

export type ThreadsPlaywrightCandidate = {
  url: string
  title: string
  excerpt: string
  source: 'threads_playwright'
  author: string | null
  postedAt: string | null
  likes: number | null
  replyCount: number | null
  images: string[]
}

const DEFAULT_LIMIT = 10
const SEARCH_TIMEOUT_MS = 30_000

export class ThreadsSearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThreadsSearchError'
  }
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

      const threadsHostPattern = /^https:\/\/(www\.)?threads\.(net|com)\//i
      const seen = new Set<string>()
      const results: Array<{ url: string; title: string; excerpt: string; author: string | null; postedAt: string | null; likes: number | null; replyCount: number | null; images: string[] }> = []
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = anchor.href
        if (!threadsHostPattern.test(href)) continue
        if (href.includes('/search?') || href.includes('/privacy') || href.includes('/login')) continue
        if (!href.includes('/post/')) continue
        const normalized = href.split('?')[0]
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
        results.push({
          url: normalized,
          title: text ? text.slice(0, 80) : 'Threads 搜尋結果',
          excerpt: text.slice(0, 240),
          author: ctx ? findAuthor(ctx) : null,
          postedAt: ctx ? findPostedAt(ctx) : null,
          likes: ctx ? findCountByHint(ctx, /like|讚/i) : null,
          replyCount: ctx ? findCountByHint(ctx, /repl|留言|comment/i) : null,
          images: ctx ? findImages(ctx) : []
        })
        if (results.length >= maxResults) break
      }
      return results
    }, limit)

    return items.map((item) => ({ ...item, source: 'threads_playwright' as const }))
  } catch (error) {
    if (error instanceof ThreadsSearchError) throw error
    throw new ThreadsSearchError(error instanceof Error ? error.message : 'Threads Playwright 搜尋失敗。')
  } finally {
    await context.close()
  }
}
