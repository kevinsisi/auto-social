import { createPublicSearchContext } from '../threads-bot/browser.js'
import type { Page } from 'playwright'
import type { ThreadsFallbackOutcome, ThreadsSearchCandidate } from './threads-fallback-search.js'

type RawBrowserResult = {
  url: string
  title: string
  excerpt: string
}

const SEARCH_TIMEOUT_MS = 30_000
const HUMAN_SETTLE_MS = 1_200
const THREADS_URL_PATTERN = /^https:\/\/(?:www\.)?threads\.(?:net|com)\/@[A-Za-z0-9_.]+\/post\/[A-Za-z0-9_-]+/

export async function fetchThreadsBrowserSearchOutcome(keyword: string, limit = 10): Promise<ThreadsFallbackOutcome> {
  const trimmed = keyword.trim()
  if (!trimmed) return { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }

  const context = await createPublicSearchContext()
  const page = await context.newPage()
  try {
    await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS })
    await page.locator('input[name="q"]').fill(`${trimmed} Threads`, { timeout: SEARCH_TIMEOUT_MS })
    await page.keyboard.press('Enter')
    await page.waitForLoadState('domcontentloaded', { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined)
    await page.waitForTimeout(HUMAN_SETTLE_MS)

    if (await isBlocked(page)) {
      return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['duckduckgo_browser'] }
    }

    await page.mouse.wheel(0, 900).catch(() => undefined)
    await page.waitForTimeout(400)

    const rawResults = await page.evaluate((maxResults) => {
      function decodeThreadsUrl(rawHref: string): string | null {
        try {
          const parsed = new URL(rawHref, location.href)
          const redirect = parsed.searchParams.get('uddg') ?? parsed.searchParams.get('u') ?? parsed.searchParams.get('url')
          const value = redirect ? decodeURIComponent(redirect) : parsed.href
          return value.match(/^https:\/\/(?:www\.)?threads\.(?:net|com)\/@[A-Za-z0-9_.]+\/post\/[A-Za-z0-9_-]+/)?.[0] ?? null
        } catch {
          return null
        }
      }

      function clean(value: string) {
        return value.replace(/\s+/g, ' ').trim()
      }

      const seen = new Set<string>()
      const out: RawBrowserResult[] = []
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const url = decodeThreadsUrl(anchor.href)
        if (!url || seen.has(url)) continue

        const container = anchor.closest('article') ?? anchor.closest('[data-testid="result"]') ?? anchor.closest('li') ?? anchor.closest('div') ?? anchor
        const title = clean(anchor.textContent ?? '')
        const containerText = clean(container.textContent ?? '')
        const excerpt = clean(containerText.replace(title, ''))
        seen.add(url)
        out.push({ url, title, excerpt })
        if (out.length >= maxResults) break
      }
      return out
    }, limit * 2)

    const candidates = normaliseBrowserResults(rawResults, trimmed).slice(0, limit)
    return candidates.length > 0
      ? { candidates, status: 'ok', providerUsed: 'duckduckgo_browser', blockedProviders: [] }
      : { candidates: [], status: 'no_results', providerUsed: null, blockedProviders: [] }
  } catch {
    return { candidates: [], status: 'blocked', providerUsed: null, blockedProviders: ['duckduckgo_browser'] }
  } finally {
    await page.close().catch(() => undefined)
    await context.close().catch(() => undefined)
  }
}

export function normaliseBrowserResults(results: RawBrowserResult[], keyword: string): ThreadsSearchCandidate[] {
  const seen = new Set<string>()
  const candidates: ThreadsSearchCandidate[] = []
  for (const result of results) {
    const url = result.url.match(THREADS_URL_PATTERN)?.[0]
    if (!url || seen.has(url)) continue
    const title = cleanText(result.title)
    const excerpt = cleanText(result.excerpt) || title
    if (!title && !excerpt) continue
    if (!isRelevant(`${title} ${excerpt}`, keyword)) continue
    seen.add(url)
    candidates.push({ url, title: title || `Threads 搜尋結果：${keyword}`, excerpt, source: 'threads_search' })
  }
  return candidates
}

async function isBlocked(page: Page) {
  const url = page.url()
  if (/duckduckgo\.com\/anomaly/i.test(url)) return true
  const text = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')
  const lowered = text.toLowerCase()
  return lowered.includes('unfortunately, bots use duckduckgo too') || lowered.includes('please complete the following challenge')
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240)
}

function isRelevant(text: string, keyword: string) {
  if (text.includes('加入 Threads') && text.includes('Instagram')) return false
  if (!keyword) return true
  if (/[\p{Script=Han}]/u.test(keyword)) return text.includes(keyword)
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
}
