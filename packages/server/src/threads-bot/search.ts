import type { AppDatabase } from '../db.js'
import { createThreadsContext } from './browser.js'
import { markThreadsSessionUnhealthy } from './session.js'

export type ThreadsPlaywrightCandidate = {
  url: string
  title: string
  excerpt: string
  source: 'threads_playwright'
}

const DEFAULT_LIMIT = 10
const SEARCH_TIMEOUT_MS = 30_000

export class ThreadsSearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThreadsSearchError'
  }
}

export async function searchThreadsWithPlaywright(db: AppDatabase, keyword: string, limit = DEFAULT_LIMIT): Promise<ThreadsPlaywrightCandidate[]> {
  const trimmed = keyword.trim()
  if (!trimmed) throw new ThreadsSearchError('Threads 搜尋關鍵字不可為空。')

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
      const threadsHostPattern = /^https:\/\/(www\.)?threads\.(net|com)\//i
      const seen = new Set<string>()
      const results: Array<{ url: string; title: string; excerpt: string }> = []
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = anchor.href
        if (!threadsHostPattern.test(href)) continue
        if (href.includes('/search?') || href.includes('/privacy') || href.includes('/login')) continue
        if (!href.includes('/post/')) continue
        const normalized = href.split('?')[0]
        if (seen.has(normalized)) continue
        let container: Element | null = anchor.closest('article') ?? anchor.closest('[role="article"]') ?? anchor.parentElement
        let text = ''
        for (let depth = 0; container && depth < 8; depth += 1) {
          const candidateText = (container.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (candidateText.length > text.length && candidateText.length < 1200) text = candidateText
          container = container.parentElement
        }
        if (text.length < 8) continue
        seen.add(normalized)
        results.push({
          url: normalized,
          title: text ? text.slice(0, 80) : 'Threads 搜尋結果',
          excerpt: text.slice(0, 240)
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
