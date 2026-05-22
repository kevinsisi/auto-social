import type { Page } from 'playwright'
import { createPublicSearchContext } from '../threads-bot/browser.js'
import { normaliseSearchResults, type ThreadsFallbackOutcome } from './threads-fallback-search.js'

type RawThreadsPublicResult = {
  url: string
  title: string
  excerpt: string
  author?: string | null
  postedAt?: string | null
  likes?: number | null
  replyCount?: number | null
  reposts?: number | null
  shares?: number | null
  images?: string[]
  videos?: Array<{ src: string; poster: string | null }>
}

export type ThreadsPublicSearchProvider = (keyword: string, limit: number) => Promise<ThreadsFallbackOutcome>

const SEARCH_TIMEOUT_MS = 30_000
const SETTLE_MS = 4_000
const THREADS_PUBLIC_PROVIDER = 'threads_public_search'

export async function fetchThreadsPublicSearchOutcome(keyword: string, limit = 10): Promise<ThreadsFallbackOutcome> {
  const trimmed = keyword.trim()
  if (!trimmed) return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }

  const context = await createPublicSearchContext()
  const page = await context.newPage()
  try {
    const url = `https://www.threads.com/search?q=${encodeURIComponent(trimmed)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
    await page.waitForTimeout(SETTLE_MS)
    await page.mouse.wheel(0, 900).catch(() => undefined)
    await page.waitForTimeout(800)

    if (await isBlocked(page)) {
      return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: [THREADS_PUBLIC_PROVIDER] }
    }

    const rawResults = await page.evaluate((maxResults) => {
      function clean(value: string) {
        return value.replace(/\s+/g, ' ').trim()
      }

      function canonicalPostUrl(rawHref: string): string | null {
        try {
          const href = new URL(rawHref, location.href).href
          return href.match(/^https:\/\/(?:www\.)?threads\.(?:net|com)\/@[A-Za-z0-9_.]+\/post\/[A-Za-z0-9_-]+/)?.[0] ?? null
        } catch {
          return null
        }
      }

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

      function findResult(anchor: HTMLAnchorElement) {
        let current: HTMLElement | null = anchor
        let fallback = ''
        let best = ''
        let root: HTMLElement = anchor
        for (let depth = 0; current && depth < 10; depth += 1) {
          const text = clean(current.innerText || current.textContent || '')
          if (!fallback && text) fallback = text
          if (text.length >= 20 && text.length <= 1_500 && hasMeaningfulText(text) && text.length > best.length) {
            best = text
            root = current
          }
          current = current.parentElement
        }
        return { root, text: best || fallback }
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
        return container.querySelector<HTMLTimeElement>('time[datetime]')?.getAttribute('datetime') ?? null
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

      function isCdnMediaUrl(src: string | null | undefined): src is string {
        return typeof src === 'string' && /^https:\/\//i.test(src) && /cdninstagram\.com|fbcdn\.net/i.test(src)
      }

      function findImages(container: Element): string[] {
        const out = new Set<string>()
        for (const img of Array.from(container.querySelectorAll<HTMLImageElement>('img'))) {
          const src = img.currentSrc || img.src
          if (!isCdnMediaUrl(src)) continue
          const rect = img.getBoundingClientRect()
          const width = rect.width || img.naturalWidth || 0
          const height = rect.height || img.naturalHeight || 0
          if (width < 120 || height < 120) continue
          const alt = (img.getAttribute('alt') ?? '').toLowerCase()
          if (alt.includes('大頭貼') || alt.includes('profile picture') || alt.includes('profile photo') || alt.includes('verified')) continue
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
          if (!isCdnMediaUrl(src)) {
            src = ''
            for (const source of Array.from(video.querySelectorAll<HTMLSourceElement>('source'))) {
              if (isCdnMediaUrl(source.src)) {
                src = source.src
                break
              }
            }
          }
          const poster = isCdnMediaUrl(video.getAttribute('poster')) ? video.getAttribute('poster') : null
          const stableSrc = isCdnMediaUrl(src) ? src : poster
          if (!stableSrc || seen.has(stableSrc)) continue
          seen.add(stableSrc)
          out.push({ src: stableSrc, poster })
          if (out.length >= 4) break
        }
        return out
      }

      function hasMeaningfulText(text: string) {
        const content = text
          .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
          .replace(/\b\d{1,3}(?:,\d{3})*\b/g, ' ')
          .replace(/翻譯|登入|註冊|Threads/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        return content.length >= 3 && /[\p{L}\p{Script=Han}]/u.test(content)
      }

      function titleFromText(text: string) {
        const lines = text.split(/\n+/).map(clean).filter(Boolean)
        return lines.find((line) => !/^\d+$/.test(line) && line !== '翻譯' && !line.includes('登入')) ?? ''
      }

      const seen = new Set<string>()
      const out: RawThreadsPublicResult[] = []
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'))) {
        const url = canonicalPostUrl(anchor.href)
        if (!url || seen.has(url)) continue
        const { root, text } = findResult(anchor)
        seen.add(url)
        out.push({
          url,
          title: titleFromText(text),
          excerpt: text,
          author: findAuthor(root),
          postedAt: findPostedAt(root),
          likes: findCount(root, text, /like|讚/i, /讚/),
          replyCount: findCount(root, text, /repl|留言|comment/i, /留言|回覆/),
          reposts: findCount(root, text, /repost|轉發/i, /轉發/),
          shares: findCount(root, text, /share|分享/i, /分享|享/),
          images: findImages(root),
          videos: findVideos(root)
        })
        if (out.length >= maxResults) break
      }
      return out
    }, limit * 3)

    const candidates = normaliseThreadsPublicResults(rawResults, trimmed).slice(0, limit)
    return candidates.length > 0
      ? { candidates, status: 'ok', providerUsed: THREADS_PUBLIC_PROVIDER, blockedProviders: [] }
      : { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  } catch {
    return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: [THREADS_PUBLIC_PROVIDER] }
  } finally {
    await page.close().catch(() => undefined)
    await context.close().catch(() => undefined)
  }
}

export function normaliseThreadsPublicResults(results: RawThreadsPublicResult[], keyword: string) {
  return normaliseSearchResults(results, keyword)
}

async function isBlocked(page: Page) {
  const url = page.url()
  const title = await page.title().catch(() => '')
  const text = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
  return isThreadsPublicSearchBlock(url, title, text)
}

export function isThreadsPublicSearchBlock(url: string, title: string, text: string) {
  const lowered = `${url}\n${title}\n${text}`.toLowerCase()
  return lowered.includes('checkpoint') ||
    lowered.includes('challenge') ||
    lowered.includes('captcha') ||
    lowered.includes('temporarily blocked') ||
    lowered.includes('suspicious activity') ||
    lowered.includes('please try again later')
}
