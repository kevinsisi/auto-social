import type { Page } from 'playwright'
import { createPublicSearchContext } from '../threads-bot/browser.js'
import { normaliseSearchResults, type ThreadsFallbackOutcome } from './threads-fallback-search.js'

type RawThreadsPublicResult = {
  url: string
  title: string
  excerpt: string
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

      function findResultText(anchor: HTMLAnchorElement) {
        let current: HTMLElement | null = anchor
        let fallback = ''
        for (let depth = 0; current && depth < 10; depth += 1) {
          const text = clean(current.innerText || current.textContent || '')
          if (!fallback && text) fallback = text
          if (text.length >= 20 && text.length <= 1_500 && hasMeaningfulText(text)) return text
          current = current.parentElement
        }
        return fallback
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
        const text = findResultText(anchor)
        seen.add(url)
        out.push({ url, title: titleFromText(text), excerpt: text })
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
