import { createPublicSearchContext } from '../threads-bot/browser.js'
import type { Page } from 'playwright'
import type { ThreadsSearchCandidate } from './threads-fallback-search.js'

const HYDRATE_TIMEOUT_MS = 12_000
const HYDRATE_SETTLE_MS = 1_200
const HYDRATE_LIMIT = 5

export async function hydrateThreadsPostCandidates(candidates: ThreadsSearchCandidate[], limit = HYDRATE_LIMIT): Promise<ThreadsSearchCandidate[]> {
  const targets = candidates.slice(0, limit)
  if (targets.length === 0) return candidates

  const context = await createPublicSearchContext()
  try {
    const page = await context.newPage()
    try {
      const hydrated: ThreadsSearchCandidate[] = []
      for (const candidate of targets) {
        hydrated.push(await hydrateOne(page, candidate))
      }
      return [...hydrated, ...candidates.slice(limit)]
    } finally {
      await page.close().catch(() => undefined)
    }
  } catch {
    return candidates
  } finally {
    await context.close().catch(() => undefined)
  }
}

async function hydrateOne(page: Page, candidate: ThreadsSearchCandidate): Promise<ThreadsSearchCandidate> {
  try {
    await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: HYDRATE_TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: HYDRATE_TIMEOUT_MS }).catch(() => undefined)
    await page.waitForTimeout(HYDRATE_SETTLE_MS)
    if (await isBlocked(page)) return candidate

    const media = await page.evaluate(() => {
      function parseCount(raw: string | null | undefined): number | null {
        if (!raw) return null
        const match = String(raw).replace(/\s+/g, ' ').trim().match(/([\d,]+(?:\.\d+)?)\s*(K|M|k|m|萬|千)?/)
        if (!match || !match[1]) return null
        const num = Number(match[1].replace(/,/g, ''))
        if (!Number.isFinite(num)) return null
        const unit = match[2] ?? ''
        if (unit === 'K' || unit === 'k' || unit === '千') return Math.round(num * 1000)
        if (unit === 'M' || unit === 'm') return Math.round(num * 1_000_000)
        if (unit === '萬') return Math.round(num * 10000)
        return Math.round(num)
      }

      function isCdnMediaUrl(src: string | null | undefined): src is string {
        return typeof src === 'string' && /^https:\/\//i.test(src) && /cdninstagram\.com|fbcdn\.net/i.test(src)
      }

      function findAuthor(container: Element): string | null {
        for (const link of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
          const href = link.getAttribute('href') ?? ''
          const match = href.match(/^(?:https:\/\/(?:www\.)?threads\.(?:net|com))?\/@([^/?#\s]+)\/?$/)
          if (match && match[1]) return `@${match[1]}`
        }
        return null
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
          if (alt.includes('profile picture') || alt.includes('profile photo') || alt.includes('大頭貼') || alt.includes('verified')) continue
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

      const root = document.querySelector('article') ?? document.querySelector('[role="article"]') ?? document.body
      const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim()
      return {
        author: findAuthor(root),
        postedAt: root.querySelector<HTMLTimeElement>('time[datetime]')?.getAttribute('datetime') ?? null,
        likes: findCount(root, text, /like|讚/i, /讚/),
        replyCount: findCount(root, text, /repl|留言|comment/i, /留言|回覆/),
        reposts: findCount(root, text, /repost|轉發/i, /轉發/),
        shares: findCount(root, text, /share|分享/i, /分享|享/),
        images: findImages(root),
        videos: findVideos(root)
      }
    })

    return {
      ...candidate,
      author: candidate.author ?? media.author,
      postedAt: candidate.postedAt ?? media.postedAt,
      likes: candidate.likes ?? media.likes,
      replyCount: candidate.replyCount ?? media.replyCount,
      reposts: candidate.reposts ?? media.reposts,
      shares: candidate.shares ?? media.shares,
      images: candidate.images && candidate.images.length > 0 ? candidate.images : media.images,
      videos: candidate.videos && candidate.videos.length > 0 ? candidate.videos : media.videos
    }
  } catch {
    return candidate
  }
}

async function isBlocked(page: Page) {
  const url = page.url()
  const title = await page.title().catch(() => '')
  const text = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
  const lowered = `${url}\n${title}\n${text}`.toLowerCase()
  return lowered.includes('checkpoint') || lowered.includes('challenge') || lowered.includes('captcha') || lowered.includes('temporarily blocked') || lowered.includes('suspicious activity') || lowered.includes('please try again later')
}
